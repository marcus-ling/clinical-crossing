"""
make_villagers.py
ACS PUMS (2024 1-year, Michigan) -> public/data/villagers.json

Samples 100 adult villagers (ages 18-85) from Wayne County, MI, using the
PUMS person weights so the 100 represent the population, not just raw rows.

Run from the project root:
    python scripts/make_villagers.py

Sources (checked 2026-10-18):
- PUMS files: https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/
- Data dictionary: PUMS_Data_Dictionary_2024.txt. Its PUMA variable is
  "based on 2020 Census definition", so we use 2020 PUMAs.
- PUMA list: 2020_Census_Tract_to_2020_PUMA.txt (Census relationship file).
  Wayne County (state 26, county 163) = PUMAs 03201-03213. All 627 tracts in
  these PUMAs are in Wayne County, so they cover the county exactly.
"""

import io
import json
import zipfile
from pathlib import Path

import pandas as pd
import requests

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
SEED = 42            # fixed random seed so the same 100 villagers come out every run
N_VILLAGERS = 100
AGE_MIN, AGE_MAX = 18, 85   # trial age range from protocol.json

PUMS_URL = "https://www2.census.gov/programs-surveys/acs/data/pums/2024/1-Year/"
PERSON_ZIP = "csv_pmi.zip"     # Michigan person records
HOUSING_ZIP = "csv_hmi.zip"    # Michigan household records

# 2020-vintage PUMAs covering Wayne County, MI (see sources above)
WAYNE_PUMAS = [f"032{n:02d}" for n in range(1, 14)]   # "03201" .. "03213"

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path(__file__).resolve().parent / ".cache"
OUT_PATH = ROOT / "public" / "data" / "villagers.json"

PERSON_COLS = ["SERIALNO", "PUMA", "AGEP", "PINCP", "ADJINC",
               "JWMNP", "ENG", "WKHP", "PWGTP"]
HOUSING_COLS = ["SERIALNO", "TYPEHUGQ", "VEH", "HUPAC"]

# Output fields use the PUMS variable names and codes from the data dictionary:
#   AGEP   age in years
#   PINCP  personal income, in 2024 dollars (ADJINC applied)
#   JWMNP  commute minutes, one way (see step 3 for filled values)
#   VEH    vehicles available to the household (0-6, 6 means 6 or more)
#   ENG    English ability: 1 very well, 2 well, 3 not well, 4 not at all.
#          PUMS leaves it blank for people who speak only English; we write 0.
#          (The under-5 blank case is already excluded by our age filter.)
#   HUPAC  children in household: 1 under 6 only, 2 ages 6-17 only,
#          3 both, 4 no children
#   WKHP   usual hours worked per week (blank in PUMS = did not work; we write 0)
#   PWGTP  person weight = how many real people this record stands for.
#          Kept for traceability only. The sample was already drawn using it,
#          so do NOT weight villagers by it again in the sim.


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def read_pums_csv(zip_name, columns):
    """Download a PUMS zip once (cached in scripts/.cache/) and read only the columns we need."""
    CACHE_DIR.mkdir(exist_ok=True)
    zip_path = CACHE_DIR / zip_name
    if not zip_path.exists():
        print(f"Downloading {zip_name} ...")
        resp = requests.get(PUMS_URL + zip_name, timeout=300)
        resp.raise_for_status()
        zip_path.write_bytes(resp.content)

    with zipfile.ZipFile(zip_path) as zf:
        csv_name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        with zf.open(csv_name) as f:
            # Read IDs and codes as text so leading zeros (e.g. PUMA "03201") are kept.
            return pd.read_csv(io.TextIOWrapper(f), usecols=columns,
                               dtype={"SERIALNO": str, "PUMA": str})


def weighted_median(values, weights):
    """Median where each row counts as many people as its weight."""
    order = values.argsort()
    v = values.iloc[order].to_numpy()
    w = weights.iloc[order].to_numpy()
    cum = w.cumsum()
    return float(v[cum >= cum[-1] / 2][0])


# ---------------------------------------------------------------------------
# 1. Load people, keep Wayne County adults 18-85
# ---------------------------------------------------------------------------
people = read_pums_csv(PERSON_ZIP, PERSON_COLS)
people["PUMA"] = people["PUMA"].str.zfill(5)
people = people[people["PUMA"].isin(WAYNE_PUMAS)]
people = people[people["AGEP"].between(AGE_MIN, AGE_MAX)]
print(f"People in Wayne PUMAs, ages {AGE_MIN}-{AGE_MAX}: {len(people)}")

# ---------------------------------------------------------------------------
# 2. Merge household variables (vehicles, children) onto each person.
#    SERIALNO identifies the household. Many people share one household, so
#    this is a many-to-one join; validate= makes pandas stop with an error if
#    any household appears twice in the household file.
# ---------------------------------------------------------------------------
households = read_pums_csv(HOUSING_ZIP, HOUSING_COLS)
df = people.merge(households, on="SERIALNO", how="left", validate="many_to_one")
assert df["TYPEHUGQ"].notna().all(), "Some people had no matching household record"

# ASSUMPTION: drop group-quarters residents (prisons, dorms, nursing homes).
# They have no VEH/HUPAC values, and trial participants are assumed to live
# in households.
n_before = len(df)
df = df[df["TYPEHUGQ"] == 1].copy()
print(f"Dropped {n_before - len(df)} group-quarters residents; {len(df)} people remain")

# ---------------------------------------------------------------------------
# 3. Commute time
#    - JWMNP present -> real commute minutes
#    - everyone else (non-workers, people who work from home, or had a job
#      but not at work) -> filled. JWMNP is blank for all of these.
#    Commute is only a proxy for travel to the trial site. Home workers
#    still have to travel to the site, so they get the fill value, not 0.
# ---------------------------------------------------------------------------
commuters = df["JWMNP"].notna()

# ASSUMPTION (fill rule): people with no commute get the weighted median
# commute of commuters in the same 13 Wayne County PUMAs. This is a stand-in
# for "how far a typical local trip takes", not their real travel time.
# These rows are flagged with JWMNP_imputed = true.
fill_minutes = weighted_median(df.loc[commuters, "JWMNP"], df.loc[commuters, "PWGTP"])
print(f"Commute fill value (weighted median of commuters): {fill_minutes:.0f} min")

df["commute_imputed"] = ~commuters
df["commute_minutes"] = df["JWMNP"]
df.loc[df["commute_imputed"], "commute_minutes"] = fill_minutes

# ---------------------------------------------------------------------------
# 4. Weighted sample of 100 people
#    Each person's chance of being picked is proportional to PWGTP (how many
#    real people they stand for).
# ---------------------------------------------------------------------------
sample = df.sample(n=N_VILLAGERS, weights="PWGTP", replace=False, random_state=SEED)

# ---------------------------------------------------------------------------
# 5. Build the villager records
# ---------------------------------------------------------------------------
villagers = []
for i, row in enumerate(sample.itertuples(), start=1):
    villagers.append({
        "id": i,
        "AGEP": int(row.AGEP),
        # PINCP is in survey-year dollars; ADJINC (6 implied decimals) converts to 2024 dollars.
        "PINCP": int(round(row.PINCP * row.ADJINC / 1_000_000)),
        "JWMNP": int(round(row.commute_minutes)),
        "JWMNP_imputed": bool(row.commute_imputed),   # our flag, not a PUMS variable
        "VEH": int(row.VEH),
        "ENG": 0 if pd.isna(row.ENG) else int(row.ENG),
        "HUPAC": int(row.HUPAC),
        # Blank WKHP = did not work in the past 12 months, so 0 hours is the true value.
        "WKHP": 0 if pd.isna(row.WKHP) else int(row.WKHP),
        "PWGTP": int(row.PWGTP),
    })

# ---------------------------------------------------------------------------
# 6. Checks, then write the file
# ---------------------------------------------------------------------------
out = pd.DataFrame(villagers)
assert len(out) == N_VILLAGERS, f"Expected {N_VILLAGERS} villagers, got {len(out)}"
assert out.notna().all().all(), "Found missing values"

OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUT_PATH.write_text(json.dumps(villagers, indent=2), encoding="utf-8")
print(f"\nWrote {len(villagers)} villagers to {OUT_PATH.relative_to(ROOT)}\n")

# ---------------------------------------------------------------------------
# 7. Print 10 villagers and min / median / max for each field
# ---------------------------------------------------------------------------
pd.set_option("display.width", 200)
print("First 10 villagers:")
print(out.head(10).to_string(index=False))

# For the summary, true/false counts as 1/0.
summary = out.drop(columns="id").astype(float)
print("\nField summary (JWMNP_imputed as 0/1):")
print(summary.agg(["min", "median", "max"]).T.to_string())

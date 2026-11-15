# Clinical Crossing

A cozy Animal Crossing-style simulation of a clinical trial, built solo for a hackathon.

**Hackathon prompt:** "Build a solution that removes a major bottleneck on the path from discovery to an approved medicine."
**Bottleneck targeted:** trial enrollment and retention. Trials often stall because of social barriers (travel, work, caregiving, language), not biology.
**Pitch line:** "Trials don't fail in the lab, they fail on the bus ride home."

## About the developer
I am a solo beginner. Keep code simple, readable, and commented. Prefer plain JavaScript patterns over clever ones. When you finish a task, explain in plain English what you changed and why. I must be able to explain the sim logic to a judge in 20 seconds.

## How it works
- Villagers (about 100) are sampled from real US census data (ACS PUMS) for ONE region. 100 villagers means 1 villager = 1 percentage point of retention.
- ONE real trial protocol, pre-parsed by hand into `public/protocol.json`, creates burdens for each villager.
- The player types 3 policy ideas in their own words. An AI reads each one and maps it to a lever from a closed list (or to nothing). The sim does all the math.
- Villagers visibly stay or drop out. A before/after retention number moves.

## Game flow
1. Intro sign: expected retention is X%; you get three policy changes; which three would do the most to widen access?
2. Three text boxes (max 200 chars each) and a Submit button. **No menu of options**: the player thinks of policies themselves. Privacy notice near Submit: the text goes to Google's Gemini API, don't enter personal information, nothing is stored.
3. `src/ai/interpret.js` posts to `/api/interpret`. On ANY failure it falls back to `src/ai/localMatcher.js` (keywords, same output shape) and shows an "Offline matcher in use" banner. The game must never break.
4. Results: new retention vs baseline; each policy with its interpretation (lever, strength, one-line reason, labeled "AI interpretation of your text") and its marginal effect in points (leave-one-out); subgroup changes (no vehicle, kids at home, limited English); rescued villagers get the green ring and walk to the clinic; two goals, no single par: for "Everyone" (overall retention) and "Groups facing barriers" (the three subgroups, each weighted equally), show the player's gain, how many of the 84 medium three-lever plans it matches or beats, and the best plan for that goal; "Play again".
5. If two policies map to the same lever, only the stronger counts and the UI says which one overlapped. If a policy maps to no lever, say plainly that the model doesn't track that kind of barrier.

## Stack and hard rules
- React + Vite. **No database, no auth.** The only backend is ONE serverless function, `api/interpret.js` (Vercel). Do not add more.
- `GEMINI_API_KEY` lives only in the environment (`.env` locally, Vercel env vars in production). Never commit, print, log, or send it to the browser (no `VITE_` prefix).
- The AI provider is swappable **inside `api/interpret.js` only** (`askModel()`). Nothing else in the app knows which provider is used.
- The function never logs player text or the key and never returns error internals. It validates input (exactly 3 strings, 1 to 200 chars, request under 2 KB) and has an 8-second timeout.
- **Do not add new dependencies without asking me first.** The data script writes JSON (not CSV) so no CSV parser is needed. Draw the chart with plain SVG or CSS bars, no chart library.
- Do not rewrite or reformat files I did not ask you to touch. Show me what you plan to change before large edits.
- Work in small steps. One task per prompt. Stop and let me test after each one.
- Data prep is a Python script in `scripts/`. Everything else is JavaScript.
- My Census API key lives in `.env`, which is listed in `.gitignore`. Never commit it, print it, or paste it into a file.

## Project structure
```
public/data/villagers.json     sampled villagers (output of the script)
public/protocol.json           the one trial protocol, hand-checked
scripts/make_villagers.py      ACS PUMS -> villagers.json
src/sim/runSim.js              the sim engine (pure function, no UI code)
src/sim/levers.js              the closed list of policy levers (name, blurb, plain-language effect)
src/sim/scoring.js             dedupe, leave-one-out, subgroups, two goals, all plans (no AI)
src/ai/validate.js             request + AI reply validation (shared by browser and function)
src/ai/interpret.js            browser: POST /api/interpret, fall back to localMatcher
src/ai/localMatcher.js         offline keyword matcher
api/interpret.js               the one serverless function (Gemini, structured output)
src/components/                Board, Villager, PolicyForm, Results, AssumptionsPanel
src/App.jsx
scripts/checkSim.js            plain node checks for the sim
scripts/checkLevers.js         plain node checks for levers, scoring, validator
```

## The sim (most important part)
`runSim(villagers, protocol, levers, seed)` is a **pure function** that returns retention and per-villager results. It must never import React or touch the DOM.

Each villager gets a burden score from: travel time to the site for each **office** visit, time lost per visit (lost work hours), no vehicle, children at home, fasting-lab conflict with work, language barrier. Telephone visits cost time but no travel. Read the visit lists and `needs_verification` flags in `protocol.json`; do not assume values that are `null`.

`dropout_probability = logistic(a + b * burden)`

- Levers only modify the burden inputs. `levers` is an array of `{ id, strength }`; `[]` is the baseline.
  - Each lever changes something concrete about the trial, only for the villagers it reaches (`buildPlan()` in `runSim.js`; plain words in `levers.js` `effect`). Levers may touch more than one existing burden term, but there are no new burden terms. Examples: satellite clinic shortens the trip but not the visit; phone visits replace some office visits but only reach villagers who can do a call in English unless interpreters are also chosen; paid leave only reaches people who work.
  - small / medium / large change what the lever acts on by 25% / 50% / 75% (`ASSUMPTIONS.strengthCuts`, an assumption). Any other effect size goes in `ASSUMPTIONS` with a comment. Different levers on the same thing multiply; the same lever twice counts once (the stronger). With no levers the baseline must stay exactly the same (`scripts/checkLevers.js` checks this).
  - The old toggles are now levers: weekendEveningHours (lostWorkHours; weekday-only visits NOT confirmed in the protocol), homeBloodDraws (travelAndVisitTime; hypothetical, the protocol uses a central lab), relaxedFasting (fastingConflict; hypothetical).
- **The AI never sets numbers.** It may only return a lever id from the closed list and a strength word; `src/ai/validate.js` throws away anything else (unknown ids, bad strengths, long reasons, reasons containing digits).
- No single par. Score on two goals that pull in different directions (everyone vs groups facing barriers), compared with all 84 medium plans found by brute force. The two goals must keep different best plans (`checkLevers.js` checks this); do not tune weights to force it. Lever sizes and plans are illustrative; say so in the assumptions panel.
- Use a seeded random number generator so results are repeatable during the demo. Write a tiny one by hand (for example mulberry32). No dependency.
- Put ALL coefficients in one `ASSUMPTIONS` object at the top of `runSim.js`, each with a comment saying whether it is sourced (with citation) or an assumption. The UI assumptions panel reads from this object.
- **Calibration:** choose the intercept `a` so baseline retention lands near the published VIVID completion rate (365 of 420, about 87%, source PMC7065168; the protocol itself planned for 25% dropout). Label `a` as "calibrated to published rate". The slope `b` and the burden weights are assumptions. Expect levers to move retention by a few points, not tens of points, and do not tune the weights just to make the demo number bigger.

## Honesty rules (never violate)
- Villagers are sampled from real data. **Behavior rules and coefficients are illustrative assumptions** unless a published source is cited. Never invent dropout rates or statistics.
- Never present sim output as a real-world prediction. Say "illustrative" in the UI.
- ACS has no diabetes or insulin variable, so villagers are a general adult proxy for trial participants. Say so in the assumptions panel.
- Do not use race or ethnicity as a biological proxy. Use structural variables only (transit, income, caregiving, language).
- Any generated villager backstory is fiction and must be labeled illustrative.
- Do not make claims about FDA policy or trial facts. If unsure, leave a `TODO: verify` comment.

## Design (no design skills, so keep it simple)
- CSS grid of rounded pastel squares, 12x12. One villager per house tile, the clinic is a larger tile in the center, with a few path and tree tiles.
- Font: Nunito (Google Fonts). Rounded corners everywhere.
- Palette: cream background, soft green, warm brown, one accent color. Define as CSS variables in one place.
- Only two animations: villagers walk to the clinic if they stay, and fade out if they drop. No other motion.
- Clicking a villager shows a speech bubble with their burden in plain language.
- Player-facing text should sound warm and human, not robotic.
- Mobile-friendly layout is nice to have, not required.

## Scope cuts (do not build these unless I say so)
Live protocol upload, multiple regions, user accounts, saved games, multiplayer, sound, voice, herb/remedy quests.
Stretch goals, only after the core works and I ask: second county (urban vs rural), a "who never gets in" view based on the protocol's exclusion criteria, voice.

## Trial and region
- Trial: NCT02561078 (VIVID), Eli Lilly and Company, protocol B5K-MC-IBHD. A historical trial (about 2015 to 2016), used as a demo scenario.
- Region: Wayne County, MI, with the site in Livonia. Choose the PUMA(s) from the Census PUMA-to-county crosswalk and tell me which; I approve before sampling. Verify, do not guess.
- Confirmed from the protocol: 17 visits total, about 29 weeks from Visit 1 to Visit 17 (1-week screening, 2-week lead-in, 26-week treatment). Office visits 5, 6, 7, 10, 13, 15, 17. Telephone visits 8, 9, 11, 12, 14, 16. Ages 18 to 85.
- NOT yet verified (see `needs_verification` in protocol.json): site street address, Visit 3, visit length, weekday-only, fasting instructions, which visits include blood draws.

## Status (I will update this as I go)
- [x] Setup and first commit
- [x] protocol.json drafted
- [ ] protocol.json open items verified against Attachments 1 and 2
- [ ] villagers.json looks like plausible humans
- [ ] runSim.js: changing a toggle moves retention in a sensible direction, baseline near 87%
- [ ] Board renders villagers and clinic
- [x] Typed-policy game (levers, scoring, Gemini interpreter with offline fallback)
- [ ] Assumptions panel
- [ ] Deployed, backup demo video recorded

## Commands
- `npm run dev` start the dev server (also serves `/api/interpret` locally; reads `GEMINI_API_KEY` from `.env`)
- `node scripts/checkSim.js` and `node scripts/checkLevers.js` run the checks
- `npm run build` production build (run before deploying)
- `python scripts/make_villagers.py` regenerate villagers.json
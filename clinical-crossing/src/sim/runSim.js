// runSim.js
// The sim engine. A pure function: no React, no DOM, no fetch.
// Give it villagers, the protocol, the toggles and a seed; it returns retention.
//
// ILLUSTRATIVE ONLY. Burden weights and the slope are assumptions, not
// published estimates. Only the intercept `a` is tied to a real number.

// ---------------------------------------------------------------------------
// ASSUMPTIONS: every number the sim uses lives here.
// The UI assumptions panel reads this object.
// ---------------------------------------------------------------------------
export const ASSUMPTIONS = {
  // Logistic model: dropProbability = 1 / (1 + e^-(a + b * burden))
  // Calibrated to published rate: VIVID completion 365 of 420 randomized
  // (about 87%), source PMC7065168. Found by bisection with
  // `node scripts/checkSim.js --calibrate` so baseline expectedRetention is about 0.87.
  // Recalibrate if villagers.json or any assumption below changes.
  a: -3.5611, // calibrated 2026-10-18 against the 100 villagers in villagers.json (seed 42)
  b: 1.0, // assumption: how strongly burden raises dropout

  // Weights for each burden term (each term is scaled 0 to 1 before weighting).
  weights: {
    travelAndVisitTime: 1.0, // assumption
    lostWorkHours: 1.0, // assumption
    noVehicle: 1.0, // assumption
    childrenAtHome: 0.5, // assumption
    fastingConflict: 0.5, // assumption
    languageBarrier: 1.0, // assumption
  },

  phoneVisitHours: 0.5, // assumption: time cost of one telephone visit (no travel)
  hoursCap: 80, // assumption: trial hours at which the time and work terms max out at 1
  homeBloodDrawCut: 0.5, // assumption: home blood draws cut travel + time of lab visits by 50%

  // assumption: score for each PUMS ENG code
  // (0 only English, 1 very well, 2 well, 3 not well, 4 not at all)
  languageScoreByEng: { 0: 0, 1: 0, 2: 0.5, 3: 1, 4: 1 },
}

// Plain-language names for each burden term (used for topBurdens and the UI).
export const BURDEN_LABELS = {
  travelAndVisitTime: 'travel and visit time',
  lostWorkHours: 'lost work hours',
  noVehicle: 'no vehicle',
  childrenAtHome: 'children at home',
  fastingConflict: 'fasting labs clash with work',
  languageBarrier: 'language barrier',
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// mulberry32: a tiny seeded random number generator.
// Same seed -> same sequence of numbers between 0 and 1, every time.
function mulberry32(seed) {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function logistic(x) {
  return 1 / (1 + Math.exp(-x))
}

// Read the visit lists from protocol.json.
function getVisits(protocol) {
  const s = protocol.schedule
  if (s.visitDurationHours == null) {
    throw new Error('protocol.schedule.visitDurationHours is null; the sim needs a visit length')
  }
  const officeVisits = [...s.officeVisitsConfirmed, ...s.officeVisitsInferred]
  if (s.visit3 === 'office') officeVisits.push(3)

  // ASSUMPTION: every office visit includes a blood draw (a "lab visit").
  // The protocol does not yet say which visits do.
  // TODO: verify against Attachments 1 and 2.
  const labVisits = officeVisits

  return {
    officeVisits,
    labVisits,
    phoneVisits: s.telephoneVisitsConfirmed,
    visitDurationHours: s.visitDurationHours,
    weekdayOnly: s.weekdayOnly === true, // assumed field in protocol.json
    fastingLikely: protocol.burdens.fasting.likely === true, // needs_verification in protocol.json
  }
}

// ---------------------------------------------------------------------------
// Burden for one villager. Returns each term already scaled 0 to 1.
// ---------------------------------------------------------------------------
function burdenTerms(villager, visits, toggles, A) {
  const works = villager.WKHP > 0

  // Round trip to the site. JWMNP (work commute) is a proxy for travel to the site.
  const travelHours = (2 * villager.JWMNP) / 60

  // Hours spent on office visits (visit + travel).
  let officeHours = 0
  for (const visit of visits.officeVisits) {
    let hours = visits.visitDurationHours + travelHours
    if (toggles.homeBloodDraws && visits.labVisits.includes(visit)) {
      hours = hours * (1 - A.homeBloodDrawCut)
    }
    officeHours += hours
  }
  const phoneHours = visits.phoneVisits.length * A.phoneVisitHours
  const totalHours = officeHours + phoneHours

  // Work hours lost: only for people who work, when visits are weekday-only,
  // and weekend visits are not offered. Phone calls are assumed to fit around work.
  const losesWork = works && visits.weekdayOnly && !toggles.weekendVisits

  return {
    travelAndVisitTime: Math.min(1, totalHours / A.hoursCap),
    lostWorkHours: losesWork ? Math.min(1, officeHours / A.hoursCap) : 0,
    noVehicle: villager.VEH === 0 ? 1 : 0,
    // HUPAC 1, 2, 3 = children under 18 in the household; 4 = none
    childrenAtHome: villager.HUPAC !== 4 ? 1 : 0,
    fastingConflict: works && visits.fastingLikely && !toggles.noFasting ? 1 : 0,
    languageBarrier: A.languageScoreByEng[villager.ENG] ?? 0,
  }
}

// ---------------------------------------------------------------------------
// runSim
//   villagers: array from villagers.json
//   protocol:  object from protocol.json
//   toggles:   { weekendVisits, homeBloodDraws, noFasting } (true/false)
//   seed:      number for the random generator (default 42)
//   assumptions: optional override, only used by the calibration script
// ---------------------------------------------------------------------------
export function runSim(villagers, protocol, toggles, seed = 42, assumptions = ASSUMPTIONS) {
  const A = assumptions
  const visits = getVisits(protocol)

  // One fixed random number per villager, in list order. Because the same
  // seed gives the same numbers, every scenario reuses them, so a villager
  // only flips from "dropped" to "stayed" when their burden really changes.
  const random = mulberry32(seed)

  const results = villagers.map((villager) => {
    const terms = burdenTerms(villager, visits, toggles, A)

    // Weighted sum of the terms.
    let burden = 0
    const contributions = []
    for (const name of Object.keys(A.weights)) {
      const amount = A.weights[name] * terms[name]
      burden += amount
      if (amount > 0) contributions.push({ name, amount })
    }

    const dropProbability = logistic(A.a + A.b * burden)
    const dropped = random() < dropProbability

    // The 3 biggest burdens, largest first.
    contributions.sort((x, y) => y.amount - x.amount)
    const topBurdens = contributions.slice(0, 3).map((c) => c.name)

    return { id: villager.id, burden, dropProbability, dropped, topBurdens }
  })

  // Headline number: average chance of staying. Smooth, not noisy.
  let sumStay = 0
  let stayed = 0
  for (const r of results) {
    sumStay += 1 - r.dropProbability
    if (!r.dropped) stayed += 1
  }

  return {
    expectedRetention: sumStay / results.length,
    sampledRetention: stayed / results.length,
    villagers: results,
  }
}

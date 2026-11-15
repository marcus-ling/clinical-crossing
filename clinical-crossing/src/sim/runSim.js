// runSim.js
// The sim engine. A pure function: no React, no DOM, no fetch.
// Give it villagers, the protocol, a list of policy levers and a seed;
// it returns retention.
//
// ILLUSTRATIVE ONLY. Burden weights and the slope are assumptions, not
// published estimates. Only the intercept `a` is tied to a real number.

import { findLever } from './levers.js'

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

  phoneVisitHours: 0.5, // assumption: time cost of one telephone visit (no travel). Also used for office visits a lever moves to phone; assumes their blood draws can be done elsewhere (TODO: verify which visits need labs)
  hoursCap: 80, // assumption: trial hours at which the time and work terms max out at 1

  // assumption: how big a change one policy lever makes. A "medium" lever
  // halves what it acts on (half the trip length, half the visits moved to
  // phone, half the childcare burden...). Illustrative, not measured.
  // Two different levers on the same thing multiply (50% then 50% = 75% total).
  strengthCuts: { small: 0.25, medium: 0.5, large: 0.75 },

  // assumption: length of a home visit (nurse or mobile lab), in hours, no travel.
  homeVisitHours: 1,
  // assumption: a nearer satellite clinic eases the no-car burden by half as
  // much as it shortens the trip (it is closer, but people still need a ride).
  satelliteNoVehicleShare: 0.5,

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
// Policy levers -> a "plan": what changes about the trial for everyone.
// Each lever changes something concrete (how far the trip is, how many
// visits happen at the clinic, ...). Its strength sets how much:
// small / medium / large = cut of 25% / 50% / 75% (ASSUMPTIONS.strengthCuts).
// If the same lever id appears twice, only the stronger one counts.
// With no levers, every factor is 1 and every share is 0 (the baseline).
// ---------------------------------------------------------------------------
function buildPlan(levers, A) {
  // Strongest cut for each lever id.
  const cut = {}
  for (const { id, strength } of levers) {
    const c = A.strengthCuts[strength]
    if (!findLever(id) || c === undefined) {
      throw new Error(`runSim: unknown lever "${id}" or strength "${strength}"`)
    }
    cut[id] = Math.max(cut[id] ?? 0, c)
  }
  const c = (id) => cut[id] ?? 0 // 0 when the lever is not chosen

  return {
    // Share of office visits that become phone calls.
    phoneShare: c('moreTelephoneVisits'),
    // Share of the REMAINING office visits that become home visits.
    homeCut: c('homeBloodDraws'),
    // Interpreters also make phone visits possible for limited-English villagers.
    interpreters: c('languageSupport') > 0,
    // Trip length: a nearer site shortens every remaining trip to the clinic.
    tripFactor: 1 - c('satelliteClinic'),
    // Multipliers on single burdens (1 = unchanged).
    lostWorkFactor: (1 - c('weekendEveningHours')) * (1 - c('paidLeave')),
    // Weekend/evening visits also stop fasting labs clashing with a work morning.
    fastingFactor: (1 - c('relaxedFasting')) * (1 - c('weekendEveningHours')),
    noVehicleFactor:
      (1 - c('transportSupport')) * (1 - A.satelliteNoVehicleShare * c('satelliteClinic')),
    childrenFactor: 1 - c('childcareSupport'),
    languageFactor: 1 - c('languageSupport'),
  }
}

// The baseline plan: nothing changes.
const NO_CHANGE = {
  phoneShare: 0, homeCut: 0, interpreters: false, tripFactor: 1,
  lostWorkFactor: 1, fastingFactor: 1, noVehicleFactor: 1, childrenFactor: 1, languageFactor: 1,
}

// ---------------------------------------------------------------------------
// Burden for one villager under a plan. Returns each term scaled 0 to 1.
// ---------------------------------------------------------------------------
function burdenTerms(villager, visits, A, plan = NO_CHANGE) {
  const works = villager.WKHP > 0
  const languageScore = A.languageScoreByEng[villager.ENG] ?? 0

  // Round trip to the site. JWMNP (work commute) is a proxy for travel to the site.
  const travelHours = ((2 * villager.JWMNP) / 60) * plan.tripFactor

  // Hours for one office visit at the clinic (visit + round trip), added up
  // over all office visits. (A loop, not a multiply, so the baseline numbers
  // match the original version exactly.)
  let officeHours = 0
  for (let i = 0; i < visits.officeVisits.length; i++) {
    officeHours += visits.visitDurationHours + travelHours
  }

  // Phone visits only reach villagers who can do a call in English, or
  // anyone if interpreters are offered. Everyone else keeps coming in.
  const canDoPhone = languageScore === 0 || plan.interpreters
  const phoneShare = canDoPhone ? plan.phoneShare : 0
  const homeShare = plan.homeCut * (1 - phoneShare) // shares never add up to more than 1
  const clinicShare = 1 - phoneShare - homeShare
  const officeCount = visits.officeVisits.length

  // Visits still at the clinic cost the full visit + trip.
  // Home visits cost a shorter visit and no trip. Converted phone visits cost a call.
  const clinicHours = officeHours * clinicShare
  const homeHours = officeCount * homeShare * A.homeVisitHours
  const phoneHours = (visits.phoneVisits.length + officeCount * phoneShare) * A.phoneVisitHours
  const totalHours = clinicHours + homeHours + phoneHours

  // Work hours lost: only for people who work, when visits are weekday-only.
  // Clinic and home visits take time out of the workday; phone calls are
  // assumed to fit around work.
  const losesWork = works && visits.weekdayOnly
  const workHours = clinicHours + homeHours

  // Fewer trips to the clinic also means fewer rides needed.
  const noVehicle = villager.VEH === 0 ? clinicShare * plan.noVehicleFactor : 0

  return {
    travelAndVisitTime: Math.min(1, totalHours / A.hoursCap),
    lostWorkHours: losesWork ? Math.min(1, workHours / A.hoursCap) * plan.lostWorkFactor : 0,
    noVehicle,
    // HUPAC 1, 2, 3 = children under 18 in the household; 4 = none
    childrenAtHome: villager.HUPAC !== 4 ? plan.childrenFactor : 0,
    fastingConflict: works && visits.fastingLikely ? plan.fastingFactor : 0,
    languageBarrier: languageScore * plan.languageFactor,
  }
}

// ---------------------------------------------------------------------------
// runSim
//   villagers: array from villagers.json
//   protocol:  object from protocol.json
//   levers:    array of { id, strength }, e.g. [{ id: 'childcareSupport', strength: 'medium' }]
//              (ids from levers.js, strength 'small' | 'medium' | 'large'). [] = baseline.
//   seed:      number for the random generator (default 42)
//   assumptions: optional override, only used by the calibration script
// ---------------------------------------------------------------------------
export function runSim(villagers, protocol, levers = [], seed = 42, assumptions = ASSUMPTIONS) {
  const A = assumptions
  const visits = getVisits(protocol)
  const plan = buildPlan(levers, A)

  // One fixed random number per villager, in list order. Because the same
  // seed gives the same numbers, every scenario reuses them, so a villager
  // only flips from "dropped" to "stayed" when their burden really changes.
  const random = mulberry32(seed)

  const results = villagers.map((villager) => {
    const terms = burdenTerms(villager, visits, A, plan)

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

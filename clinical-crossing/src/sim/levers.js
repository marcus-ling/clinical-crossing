// levers.js
// The closed list of policy levers the game understands.
// Each lever changes something concrete about the trial (how long the trip
// is, how many visits happen at the clinic, ...), and only for the villagers
// it actually reaches. The math for each lever lives in buildPlan() in
// runSim.js; `effect` below says the same thing in plain words for the UI.
// The AI (or the offline matcher) may only pick an id from this list and a
// strength word. It never sets a number: the size of each change lives in
// ASSUMPTIONS in runSim.js.
//
// ILLUSTRATIVE ONLY. These are not measured real-world policy effects.

export const LEVERS = [
  {
    id: 'weekendEveningHours',
    name: 'Weekend and evening visit hours',
    blurb: 'Visits outside working hours, so people miss less work.',
    effect: 'Less lost work, and fasting labs no longer clash with a work morning. Helps people who work.',
  },
  {
    id: 'paidLeave',
    name: 'Paid time off or wage replacement',
    blurb: 'Covering the pay people lose when a visit eats into their workday.',
    effect: 'Less lost work for people who work. Visits still take the same time.',
  },
  {
    id: 'homeBloodDraws',
    name: 'Home or mobile blood draws',
    blurb: 'A nurse or mobile lab comes to them, so fewer trips to the clinic.',
    effect: 'Some visits happen at home: no trip, a shorter visit, and fewer rides needed. Helps long commutes and people without a car most.',
  },
  {
    id: 'moreTelephoneVisits',
    name: 'More telephone or video visits',
    blurb: 'Swapping some in-person check-ins for calls.',
    effect: 'Some visits become short calls: no trip and no lost work. Only reaches people who can do a call in English, unless interpreters are offered too.',
  },
  {
    id: 'satelliteClinic',
    name: 'A satellite clinic closer to home',
    blurb: 'A second, nearer site so the trip is shorter.',
    effect: 'Shorter trips (the visit itself takes as long), and a bit easier without a car. Helps long commutes most.',
  },
  {
    id: 'relaxedFasting',
    name: 'Relaxed fasting rules',
    blurb: 'Fewer fasting blood tests that clash with a work morning.',
    effect: 'Fasting labs clash less with a work morning. Helps people who work.',
  },
  {
    id: 'transportSupport',
    name: 'Rides or transport support',
    blurb: 'Rides, transit passes or travel costs for people without a car.',
    effect: 'Eases getting there without a car. Helps people with no car at home.',
  },
  {
    id: 'childcareSupport',
    name: 'Childcare support',
    blurb: 'Someone to watch the kids during visits.',
    effect: 'Eases finding care for kids during visits. Helps people with kids at home.',
  },
  {
    id: 'languageSupport',
    name: 'Interpreters and translated materials',
    blurb: 'Interpreters at visits and forms in the languages people read.',
    effect: 'Eases the language barrier, and lets people with limited English use phone visits. Helps people with limited English.',
  },
]

export const LEVER_IDS = LEVERS.map((lever) => lever.id)
export const STRENGTHS = ['small', 'medium', 'large']

// Quick lookup: id -> lever object (undefined if the id is not in the list).
export function findLever(id) {
  return LEVERS.find((lever) => lever.id === id)
}

// levers.js
// The closed list of policy levers the game understands.
// Each lever shrinks exactly ONE existing burden term in runSim.js.
// The AI (or the offline matcher) may only pick an id from this list and a
// strength word. It never sets a number: the size of each cut lives in
// ASSUMPTIONS.strengthCuts in runSim.js.
//
// ILLUSTRATIVE ONLY. These are not measured real-world policy effects.

export const LEVERS = [
  {
    id: 'weekendEveningHours',
    term: 'lostWorkHours',
    name: 'Weekend and evening visit hours',
    blurb: 'Visits outside working hours, so people miss less work.',
  },
  {
    id: 'paidLeave',
    term: 'lostWorkHours',
    name: 'Paid time off or wage replacement',
    blurb: 'Covering the pay people lose when a visit eats into their workday.',
  },
  {
    id: 'homeBloodDraws',
    term: 'travelAndVisitTime',
    name: 'Home or mobile blood draws',
    blurb: 'A nurse or mobile lab comes to them, so fewer trips to the clinic.',
  },
  {
    id: 'moreTelephoneVisits',
    term: 'travelAndVisitTime',
    name: 'More telephone or video visits',
    blurb: 'Swapping some in-person check-ins for calls.',
  },
  {
    id: 'satelliteClinic',
    term: 'travelAndVisitTime',
    name: 'A satellite clinic closer to home',
    blurb: 'A second, nearer site so the trip is shorter.',
  },
  {
    id: 'relaxedFasting',
    term: 'fastingConflict',
    name: 'Relaxed fasting rules',
    blurb: 'Fewer fasting blood tests that clash with a work morning.',
  },
  {
    id: 'transportSupport',
    term: 'noVehicle',
    name: 'Rides or transport support',
    blurb: 'Rides, transit passes or travel costs for people without a car.',
  },
  {
    id: 'childcareSupport',
    term: 'childrenAtHome',
    name: 'Childcare support',
    blurb: 'Someone to watch the kids during visits.',
  },
  {
    id: 'languageSupport',
    term: 'languageBarrier',
    name: 'Interpreters and translated materials',
    blurb: 'Interpreters at visits and forms in the languages people read.',
  },
]

export const LEVER_IDS = LEVERS.map((lever) => lever.id)
export const STRENGTHS = ['small', 'medium', 'large']

// Quick lookup: id -> lever object (undefined if the id is not in the list).
export function findLever(id) {
  return LEVERS.find((lever) => lever.id === id)
}

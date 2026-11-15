// AssumptionsPanel.jsx
// A fold-out list of every assumption behind the numbers. Reads straight
// from ASSUMPTIONS and LEVERS, so it can't drift from what the sim does.

import { ASSUMPTIONS, BURDEN_LABELS } from '../sim/runSim.js'
import { LEVERS } from '../sim/levers.js'

const pct = (x) => `${Math.round(x * 100)}%`

export default function AssumptionsPanel() {
  const cuts = ASSUMPTIONS.strengthCuts
  return (
    <details className="assumptions">
      <summary>How the numbers work (and what we assumed)</summary>

      <p>
        <strong>Everything here is illustrative.</strong> It&apos;s a toy model to help think about barriers, not a
        prediction of what any real policy would do.
      </p>

      <h3>The villagers</h3>
      <p>
        Each villager is a real (anonymous) adult from US Census survey data for Wayne County, Michigan. The census
        doesn&apos;t record diabetes, so they stand in for adults in general, not the people who actually joined
        this trial.
      </p>

      <h3>Who drops out</h3>
      <p>
        Every villager gets a burden score from travel and visit time, lost work hours, not having a car, kids at
        home, fasting labs that clash with work, and language. A higher score means a higher chance of dropping out.
        The starting point is tuned so about 87% stay, matching the published completion rate for the real trial
        (365 of 420, PMC7065168). How much each burden counts is our assumption:
      </p>
      <ul>
        {Object.keys(ASSUMPTIONS.weights).map((name) => (
          <li key={name}>
            {BURDEN_LABELS[name]}: weight {ASSUMPTIONS.weights[name]} (assumption)
          </li>
        ))}
      </ul>

      <h3>Your policy changes</h3>
      <p>
        Each idea you type is matched to one of the levers below, and each lever eases exactly one burden. A small
        step cuts that burden by {pct(cuts.small)}, a solid step by {pct(cuts.medium)} and a big step by{' '}
        {pct(cuts.large)}. These sizes are assumptions, not measured effects. Two levers on the same burden stack
        (half, then half again).
      </p>
      <ul>
        {LEVERS.map((lever) => (
          <li key={lever.id}>
            {lever.name}: eases {BURDEN_LABELS[lever.term]}
          </li>
        ))}
      </ul>

      <h3>Par and your score</h3>
      <p>
        Par is the best three levers at a solid (medium) step, found by trying every combination. Your score is
        how many points you gained compared with par. Par is just an illustrative yardstick, not a recommended
        policy package.
      </p>

      <h3>The AI&apos;s job</h3>
      <p>
        The AI only reads your words and picks a lever and a step size from the fixed list. It never sets any
        numbers. If the AI is unavailable, a simple keyword matcher takes over.
      </p>
    </details>
  )
}

// Results.jsx
// What the player's three policies did. Words about what each policy MEANS
// come from the AI (or the offline matcher) and are labeled that way.
// Every number on this screen comes from the simulation.

import { findLever } from '../sim/levers.js'

// "+2.3 points", "−0.4 points", "no change"
function points(change) {
  const value = Math.round(change * 1000) / 10 // one decimal place
  if (value === 0) return 'no change'
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)} points`
}

// One decimal place, so small subgroup changes don't look like "81% → 81%".
const pct = (x) => `${(x * 100).toFixed(1)}%`

// A friendly description of how strongly a policy was read.
const STRENGTH_WORDS = {
  small: 'a small step',
  medium: 'a solid step',
  large: 'a big step',
}

// round:    result of scoreRound()
// texts:    the 3 policies as the player typed them
// source:   'ai' or 'offline'
export default function Results({ round, texts, source, onPlayAgain }) {
  const readingLabel =
    source === 'ai' ? 'AI interpretation of your text' : "The offline matcher's reading of your text"

  const parNames = round.par.levers.map((l) => findLever(l.id).name.toLowerCase())

  return (
    <section className="results" aria-label="Results">
      <h2 className="results-title">How your changes did</h2>

      <ol className="policy-results">
        {round.policies.map((p) => {
          const lever = p.leverId ? findLever(p.leverId) : null
          return (
            <li key={p.policyIndex} className="policy-result">
              <p className="policy-quote">“{texts[p.policyIndex]}”</p>

              {lever ? (
                <>
                  <p className="policy-reading">
                    <span className="reading-label">{readingLabel}:</span> {lever.name}, {STRENGTH_WORDS[p.strength]}.{' '}
                    {p.reason}
                  </p>
                  {p.counts ? (
                    <p className="policy-effect">
                      Worth <strong>{points(p.marginal)}</strong> to the town.
                    </p>
                  ) : (
                    <p className="policy-effect">
                      This overlaps with change {p.overlapsWith + 1}, which hits the same barrier just as hard or
                      harder, so only that one counts.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="policy-effect">
                    Our model doesn&apos;t track that kind of barrier, so this one didn&apos;t change anything.
                  </p>
                  {p.note && (
                    <p className="policy-reading">
                      <span className="reading-label">{readingLabel}:</span> {p.note}
                    </p>
                  )}
                </>
              )}
              {lever && p.note && <p className="policy-note">{p.note}</p>}
            </li>
          )
        })}
      </ol>

      <h3 className="results-subtitle">Who it helped most</h3>
      <ul className="subgroup-list">
        {round.subgroups.map((g) => (
          <li key={g.id} className="subgroup">
            <span className="subgroup-name">
              {g.label} <span className="subgroup-count">({g.count} villagers)</span>
            </span>
            <span className="subgroup-numbers">
              {pct(g.before)} → {pct(g.after)} <strong>{points(g.after - g.before)}</strong>
            </span>
          </li>
        ))}
      </ul>

      <div className="score-card">
        <p className="score-line">
          Score: <strong>{Math.round(round.score * 100)}%</strong> of par
        </p>
        <p className="score-par">
          Par was {parNames[0]}, {parNames[1]} and {parNames[2]}, for {points(round.par.gain)}.
        </p>
      </div>

      <button type="button" className="submit-button" onClick={onPlayAgain}>
        Play again
      </button>
    </section>
  )
}

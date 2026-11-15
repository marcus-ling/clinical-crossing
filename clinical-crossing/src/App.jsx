import { useEffect, useMemo, useState } from 'react'
import Board from './components/Board.jsx'
import PolicyForm from './components/PolicyForm.jsx'
import Results from './components/Results.jsx'
import AssumptionsPanel from './components/AssumptionsPanel.jsx'
import { runSim } from './sim/runSim.js'
import { findPar, scoreRound } from './sim/scoring.js'
import { interpretPolicies } from './ai/interpret.js'
import { validatePolicies } from './ai/validate.js'
import './App.css'

// BASE_URL keeps the paths right if the site is deployed under a sub-folder.
const VILLAGERS_URL = `${import.meta.env.BASE_URL}data/villagers.json`
const PROTOCOL_URL = `${import.meta.env.BASE_URL}protocol.json`
// Optional. AI-written fiction made at build time by scripts/droidStories.mjs.
const STORIES_URL = `${import.meta.env.BASE_URL}data/stories.json`

// Same seed as scripts/checkSim.js, so the faded villagers match its sampled run.
const SEED = 42
const EMPTY_POLICIES = ['', '', '']

async function loadJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`)
  return res.json()
}

const pct = (x) => `${Math.round(x * 100)}%`

function App() {
  const [data, setData] = useState(null) // { villagers, protocol }
  const [error, setError] = useState(null)
  const [stories, setStories] = useState({}) // villager id -> story text; {} = no stories

  // The game: the player writes 3 policies, we interpret them, then show results.
  const [policies, setPolicies] = useState(EMPTY_POLICIES)
  const [busy, setBusy] = useState(false) // waiting for the interpreter
  const [outcome, setOutcome] = useState(null) // { round, texts, source } once submitted

  // Load the data once when the page opens.
  useEffect(() => {
    let cancelled = false // ignore a response that arrives after the page is gone
    Promise.all([loadJson(VILLAGERS_URL), loadJson(PROTOCOL_URL)])
      .then(([villagers, protocol]) => {
        if (!cancelled) setData({ villagers, protocol })
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    // Stories are optional and loaded on their own. If the file is missing or
    // broken we keep {} and the bubbles fall back to plain-language burdens.
    loadJson(STORIES_URL)
      .then((file) => {
        if (!cancelled && file && typeof file.stories === 'object') setStories(file.stories)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Baseline (no changes) and par (best 3 levers at medium) never change, so work them out once.
  const baseline = useMemo(() => (data ? runSim(data.villagers, data.protocol, [], SEED) : null), [data])
  const par = useMemo(() => (data ? findPar(data.villagers, data.protocol, SEED) : null), [data])

  async function handleSubmit() {
    const texts = validatePolicies(policies)
    if (!texts) return // the button is disabled in this case anyway
    setBusy(true)
    // interpretPolicies never throws: on any problem it uses the offline matcher.
    const { interpretations, source } = await interpretPolicies(texts)
    const round = scoreRound(data.villagers, data.protocol, interpretations, par, SEED)
    setOutcome({ round, texts, source })
    setBusy(false)
  }

  function handlePlayAgain() {
    setOutcome(null)
    setPolicies(EMPTY_POLICIES)
  }

  // The town shows the baseline until results arrive, then the new run.
  const current = outcome ? outcome.round.current : baseline

  let rescuedCount = 0
  if (baseline && current) {
    current.villagers.forEach((r, i) => {
      if (baseline.villagers[i].dropped && !r.dropped) rescuedCount += 1
    })
  }

  return (
    <main className="app">
      <header className="header">
        <h1>Clinical Crossing</h1>
        <span className="illustrative-badge">Illustrative simulation, not a prediction</span>
      </header>

      {error && <p className="message">{error}</p>}
      {!error && !data && <p className="message">Loading the town…</p>}

      {data && (
        <>
          {/* The wooden sign. Before playing it asks the question; after, it shows
              the before/after numbers. aria-live reads the change out loud. */}
          <section className="sign" aria-label="Retention" aria-live="polite">
            <div className="sign-board">
              {!outcome ? (
                <>
                  <h2 className="sign-title">Welcome to town!</h2>
                  <p className="sign-intro">
                    Right now, about <strong>{pct(baseline.expectedRetention)}</strong> of villagers are expected to
                    make it to the end of this diabetes trial. You get three policy changes. Which three would do
                    the most to open the trial up to more people?
                  </p>
                </>
              ) : (
                <>
                  <h2 className="sign-title">Retention</h2>
                  <p className="sign-numbers">
                    <span className="sign-pair">
                      <span className="sign-label">Before</span> <strong>{pct(baseline.expectedRetention)}</strong>
                    </span>
                    <span className="sign-arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="sign-pair">
                      <span className="sign-label">After</span>{' '}
                      <strong>{pct(outcome.round.current.expectedRetention)}</strong>
                    </span>
                    <span className="sign-diff">
                      {outcome.round.gain >= 0 ? '+' : ''}
                      {(outcome.round.gain * 100).toFixed(1)} pts
                    </span>
                  </p>
                  <p className="sign-rescued">
                    <span className="ring-swatch" aria-hidden="true" />
                    {rescuedCount === 0
                      ? 'Nobody new stayed this time'
                      : `${rescuedCount} villager${rescuedCount === 1 ? '' : 's'} stayed who would have left`}
                  </p>
                  <p className="sign-note">
                    Illustrative. The faded villagers and green rings below are one roll of the dice.
                  </p>
                </>
              )}
            </div>
            <div className="sign-posts" aria-hidden="true" />
          </section>

          {outcome && outcome.source === 'offline' && (
            <p className="offline-banner" role="status">
              Offline matcher in use. The AI couldn&apos;t be reached, so a simple keyword matcher read your ideas
              instead.
            </p>
          )}

          {outcome ? (
            <Results round={outcome.round} texts={outcome.texts} source={outcome.source} onPlayAgain={handlePlayAgain} />
          ) : (
            <PolicyForm policies={policies} onChange={setPolicies} onSubmit={handleSubmit} busy={busy} />
          )}

          <Board
            villagers={data.villagers}
            results={current.villagers}
            baselineResults={baseline.villagers}
            stories={stories}
          />

          <AssumptionsPanel />
        </>
      )}

      {/* Only credit the stories when they actually loaded. */}
      {Object.keys(stories).length > 0 && (
        <footer className="footer">Stories generated at build time with the Factory Droid SDK.</footer>
      )}
    </main>
  )
}

export default App

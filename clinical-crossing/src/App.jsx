import { useEffect, useMemo, useState } from 'react'
import Board from './components/Board.jsx'
import Toggles from './components/Toggles.jsx'
import { runSim } from './sim/runSim.js'
import './App.css'

// BASE_URL keeps the paths right if the site is deployed under a sub-folder.
const VILLAGERS_URL = `${import.meta.env.BASE_URL}data/villagers.json`
const PROTOCOL_URL = `${import.meta.env.BASE_URL}protocol.json`
// Optional. AI-written fiction made at build time by scripts/droidStories.mjs.
const STORIES_URL = `${import.meta.env.BASE_URL}data/stories.json`

// Same seed as scripts/checkSim.js, so the faded villagers match its sampled run.
const SEED = 42
const ALL_OFF = { weekendVisits: false, homeBloodDraws: false, noFasting: false }

async function loadJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`)
  return res.json()
}

const pct = (x) => `${Math.round(x * 100)}%`

function App() {
  const [data, setData] = useState(null) // { villagers, protocol }
  const [toggles, setToggles] = useState(ALL_OFF)
  const [error, setError] = useState(null)
  const [stories, setStories] = useState({}) // villager id -> story text; {} = no stories

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

  // Baseline: all toggles off. Current: whatever the switches say.
  // Both use the same seed, so each villager keeps the same random number.
  const baseline = useMemo(() => (data ? runSim(data.villagers, data.protocol, ALL_OFF, SEED) : null), [data])
  const current = useMemo(() => (data ? runSim(data.villagers, data.protocol, toggles, SEED) : null), [data, toggles])

  let rescuedCount = 0
  if (baseline && current) {
    current.villagers.forEach((r, i) => {
      if (baseline.villagers[i].dropped && !r.dropped) rescuedCount += 1
    })
  }

  const diffPoints = current && baseline ? (current.expectedRetention - baseline.expectedRetention) * 100 : 0

  return (
    <main className="app">
      <header className="header">
        <h1>Clinical Crossing</h1>
        <span className="illustrative-badge">Illustrative simulation</span>
      </header>

      {error && <p className="message">{error}</p>}
      {!error && !data && <p className="message">Loading the town…</p>}

      {data && (
        <>
          <section className="headline">
            <div className="scores">
              <div className="score">
                <span className="score-label">Baseline</span>
                <span className="score-number">{pct(baseline.expectedRetention)}</span>
              </div>
              <div className="score">
                <span className="score-label">With changes</span>
                <span className="score-number">{pct(current.expectedRetention)}</span>
              </div>
              <div className="score">
                <span className="score-label">Difference</span>
                <span className="score-number">
                  {diffPoints >= 0 ? '+' : ''}
                  {diffPoints.toFixed(1)} pts
                </span>
              </div>
            </div>
            <p className="headline-note">
              Expected retention. Faded villagers are one random draw; the headline is the expected value.
              {rescuedCount > 0 && ` ${rescuedCount} villager${rescuedCount === 1 ? '' : 's'} rescued in this draw (green ring).`}
            </p>
          </section>

          <Toggles toggles={toggles} onChange={setToggles} />
          <Board villagers={data.villagers} results={current.villagers} baselineResults={baseline.villagers} stories={stories} />
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

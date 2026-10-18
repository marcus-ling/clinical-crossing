// Toggles.jsx
// The three what-if switches. Each one only changes burden inputs in runSim.

const SWITCHES = [
  {
    key: 'weekendVisits',
    label: 'Weekend visits',
    hint: 'Removes lost work hours. Assumes visits are weekday-only, which the protocol does not confirm.',
  },
  {
    key: 'homeBloodDraws',
    label: 'Home blood draws',
    hint: 'Hypothetical: halves travel and visit time for lab visits (the real trial used a central lab).',
  },
  {
    key: 'noFasting',
    label: 'No fasting',
    hint: 'Hypothetical: removes the clash between fasting labs and work.',
  },
]

export default function Toggles({ toggles, onChange }) {
  return (
    <section className="toggles">
      {SWITCHES.map((s) => (
        <label key={s.key} className="toggle">
          <input
            type="checkbox"
            role="switch"
            checked={toggles[s.key]}
            onChange={(e) => onChange({ ...toggles, [s.key]: e.target.checked })}
          />
          <span className="toggle-text">
            <span className="toggle-label">{s.label}</span>
            <span className="toggle-hint">{s.hint}</span>
          </span>
        </label>
      ))}
    </section>
  )
}

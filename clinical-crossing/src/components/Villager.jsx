// Villager.jsx
// One house tile. Faded if the villager dropped out in this random draw.
// Villagers who stay step out toward the clinic. Clicking a tile opens a
// speech bubble with their biggest burdens.

// Plain-language phrase for each burden term from runSim's topBurdens.
const BURDEN_PHRASES = {
  travelAndVisitTime: 'Hours of visits and travel',
  lostWorkHours: 'Missing work for visits',
  noVehicle: 'No car',
  childrenAtHome: 'Kids at home',
  fastingConflict: 'Fasting labs clash with work',
  languageBarrier: 'Language barrier',
}

function villagerEmoji(villager) {
  return villager.AGEP >= 65 ? '🧓' : '🧑'
}

// How far a staying villager walks toward the clinic, as a share of one tile.
const WALK_DISTANCE = 0.35

// walking:   true = standing out toward the clinic, false = at home
// direction: { x, y } unit vector pointing at the clinic
// rescued:   dropped in the baseline but stays with the current toggles
// story:     AI-written fiction from stories.json, or undefined if there is none
// row and col decide which way the bubble opens, so it stays on the board.
export default function Villager({ villager, result, story, rescued, walking, direction, row, col, isOpen, onClick }) {
  const bubbleClasses = ['bubble']
  if (row < 2) bubbleClasses.push('bubble-below')
  if (col < 3) bubbleClasses.push('bubble-left')
  if (col > 8) bubbleClasses.push('bubble-right')

  return (
    <div className="tile-wrap">
      <button
        type="button"
        className={`tile house ${result.dropped ? 'dropped' : ''} ${rescued ? 'rescued' : ''}`}
        title={`Villager ${villager.id}, age ${villager.AGEP}`}
        onClick={onClick}
      >
        <span
          className="walker"
          // Percent in translate() is a share of the walker's own size, which fills the tile.
          style={{
            transform: walking
              ? `translate(${direction.x * WALK_DISTANCE * 100}%, ${direction.y * WALK_DISTANCE * 100}%)`
              : 'none',
          }}
        >
          {villagerEmoji(villager)}
        </span>
      </button>

      {isOpen && (
        <div className={bubbleClasses.join(' ')}>
          {story ? (
            // Story first (fiction, clearly labeled), then the real model burdens.
            <>
              <p className="bubble-story">“{story}”</p>
              <p className="bubble-story-label">AI-written fiction, illustrative</p>
              <ul className="bubble-burdens">
                {result.topBurdens.map((name) => (
                  <li key={name}>{BURDEN_PHRASES[name]}</li>
                ))}
              </ul>
            </>
          ) : (
            // No story for this villager: the plain-language burdens, as before.
            <p className="bubble-main">{result.topBurdens.map((name) => BURDEN_PHRASES[name]).join(', ')}</p>
          )}
          <p className="bubble-detail">
            Age {villager.AGEP}. Chance of dropping out: {Math.round(result.dropProbability * 100)}%.
            {result.dropped ? ' Dropped out in this draw.' : ' Stayed in this draw.'}
          </p>
          {rescued && <p className="bubble-rescued">Rescued: dropped out before these changes.</p>}
          <p className="bubble-note">Illustrative</p>
        </div>
      )}
    </div>
  )
}

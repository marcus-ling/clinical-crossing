// Villager.jsx
// One house tile: a roof, a wall with a door, and the villager standing in
// front. Villagers who stay step out toward the clinic; villagers who drop
// out in this random draw fade away (the house stays). Clicking a tile opens
// a speech bubble with their story and their biggest burdens.

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
// rescued:   dropped in the baseline but stays with the current policies
// story:     AI-written fiction from stories.json, or undefined if there is none
// row and col decide which way the bubble opens, so it stays on the board.
export default function Villager({ villager, result, story, rescued, walking, direction, row, col, isOpen, onClick }) {
  const bubbleClasses = ['bubble']
  if (row < 2) bubbleClasses.push('bubble-below')
  if (col < 4) bubbleClasses.push('bubble-left')
  if (col > 7) bubbleClasses.push('bubble-right')

  const status = result.dropped ? 'dropped out' : 'stayed'
  const bubbleId = `bubble-${villager.id}`

  return (
    <div className="tile-wrap">
      <button
        type="button"
        className={`tile house ${result.dropped ? 'dropped' : ''} ${rescued ? 'rescued' : ''}`}
        aria-label={`Villager ${villager.id}, age ${villager.AGEP}, ${status}${rescued ? ', rescued' : ''}`}
        aria-expanded={isOpen}
        aria-controls={isOpen ? bubbleId : undefined}
        onClick={onClick}
      >
        {/* The house itself, drawn with CSS shapes */}
        <span className="house-roof" aria-hidden="true" />
        <span className="house-body" aria-hidden="true">
          <span className="house-door" />
        </span>

        {/* Rescued: a green ring and a heart tag. They only appear when a
            policy rescues someone, so the little pop is a response to the player. */}
        {rescued && <span className="rescued-ring" aria-hidden="true" />}
        {rescued && (
          <span className="rescued-tag" aria-hidden="true">
            💚
          </span>
        )}

        <span
          className="walker"
          aria-hidden="true"
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
        <div id={bubbleId} className={bubbleClasses.join(' ')}>
          {story && (
            // Story first (fiction, clearly labeled), then the real model burdens.
            <>
              <p className="bubble-story">“{story}”</p>
              <p className="bubble-story-label">AI-written fiction, illustrative</p>
            </>
          )}
          <p className="bubble-heading">What the model counts</p>
          <ul className="bubble-burdens">
            {result.topBurdens.map((name) => (
              <li key={name}>{BURDEN_PHRASES[name]}</li>
            ))}
          </ul>
          <p className="bubble-detail">
            Age {villager.AGEP}. Chance of dropping out: {Math.round(result.dropProbability * 100)}%.
            {result.dropped ? ' Dropped out in this draw.' : ' Stayed in this draw.'}
          </p>
          {rescued && <p className="bubble-rescued">Rescued: dropped out before these changes.</p>}
          {!story && <p className="bubble-note">Illustrative</p>}
        </div>
      )}
    </div>
  )
}

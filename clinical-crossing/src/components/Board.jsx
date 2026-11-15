// Board.jsx
// The town: a 12x12 grid of tiles. The layout is drawn as text below so it is
// easy to see and edit. Villagers move into the house tiles in order.

import { useEffect, useState } from 'react'
import Villager from './Villager.jsx'

// One letter per tile:
//   H house (one villager each)   C clinic (3x3 block in the center)
//   P path    T tree    G grass (with a flower)
// There must be exactly 100 H tiles.
const TOWN_MAP = [
  'THHHHPHHHHHT',
  'HHHHHPHHHGHH',
  'HHHHHPHHTHHH',
  'HHHHPPPHHHHH',
  'HTHPCCCPHHHH',
  'PPPPCCCPPPPP',
  'HTHPCCCPHHHH',
  'HHHHPPPHHHHH',
  'HHHHHPHHHHHH',
  'HHHTHPHHHHHH',
  'HHHHHPHHHHHH',
  'THHHHPHHHHHT',
]

// Center of the clinic, in tile units (row 0 / column 0 = top-left corner of the board).
// The clinic is 9 C tiles, so its center is the average of their centers.
const CLINIC_CENTER = (() => {
  let rowSum = 0
  let colSum = 0
  let count = 0
  TOWN_MAP.forEach((row, r) => {
    row.split('').forEach((letter, c) => {
      if (letter === 'C') {
        rowSum += r + 0.5
        colSum += c + 0.5
        count += 1
      }
    })
  })
  return { row: rowSum / count, col: colSum / count }
})()

// Unit direction from a tile's center toward the clinic: { x, y }, each -1 to 1.
function directionToClinic(r, c) {
  const x = CLINIC_CENTER.col - (c + 0.5)
  const y = CLINIC_CENTER.row - (r + 0.5)
  const length = Math.hypot(x, y)
  return { x: x / length, y: y / length }
}

// villagers:       from villagers.json
// results:         runSim(...).villagers for the current policies, same order as villagers
// baselineResults: runSim(...).villagers with no policy changes (to spot "rescued" villagers)
// stories:         { "<villager id>": "story text" } from stories.json, or {} if none
export default function Board({ villagers, results, baselineResults, stories = {} }) {
  // id of the villager whose speech bubble is open (null = none)
  const [openId, setOpenId] = useState(null)

  // Everyone starts at home. One moment after the first draw, villagers who
  // stay walk toward the clinic. Waiting two animation frames makes sure the
  // browser has drawn the "at home" position first, so the CSS transition plays.
  const [walkedOut, setWalkedOut] = useState(false)
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setWalkedOut(true))
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  // While a bubble is open, the Escape key closes it.
  useEffect(() => {
    if (openId === null) return
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId])

  const tiles = []
  let nextVillager = 0
  let clinicDrawn = false

  TOWN_MAP.forEach((row, r) => {
    row.split('').forEach((letter, c) => {
      const key = `${r}-${c}`

      if (letter === 'C') {
        // Draw the clinic once, as one tile that spans 3 rows and 3 columns:
        // a roof on top, then a wall with a name plank and the clinic emoji.
        if (!clinicDrawn) {
          clinicDrawn = true
          tiles.push(
            <div
              key={key}
              className="tile clinic"
              style={{ gridRow: `${r + 1} / span 3`, gridColumn: `${c + 1} / span 3` }}
            >
              <span className="clinic-roof" aria-hidden="true" />
              <span className="clinic-body">
                <span className="clinic-label">Clinic</span>
                <span className="clinic-icon" aria-hidden="true">🏥</span>
              </span>
            </div>,
          )
        }
        return
      }

      if (letter === 'H') {
        const villager = villagers[nextVillager]
        const result = results[nextVillager]
        const baselineResult = baselineResults[nextVillager]
        nextVillager += 1
        if (!villager) {
          tiles.push(<div key={key} className="tile house" title="Empty house" />)
          return
        }
        tiles.push(
          <Villager
            key={key}
            villager={villager}
            result={result}
            story={stories[String(villager.id)]}
            rescued={baselineResult.dropped && !result.dropped}
            walking={walkedOut && !result.dropped}
            direction={directionToClinic(r, c)}
            row={r}
            col={c}
            isOpen={openId === villager.id}
            // Click again to close, or click someone else to switch.
            onClick={() => setOpenId(openId === villager.id ? null : villager.id)}
          />,
        )
        return
      }

      if (letter === 'T') {
        tiles.push(<div key={key} className="tile grass tree" aria-hidden="true">🌳</div>)
        return
      }

      if (letter === 'G') {
        tiles.push(<div key={key} className="tile grass flower" aria-hidden="true">🌼</div>)
        return
      }

      // P path: a plain sand-colored square. With no gap between tiles, paths join up.
      tiles.push(<div key={key} className="tile path" />)
    })
  })

  return (
    <div className="board" aria-label="The town. Each house is one villager; select a house to read about them.">
      {tiles}
    </div>
  )
}

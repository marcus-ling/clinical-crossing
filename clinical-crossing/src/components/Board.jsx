// Board.jsx
// The town: a 12x12 grid of tiles. The layout is drawn as text below so it is
// easy to see and edit. Villagers move into the house tiles in order.

import { useEffect, useState } from 'react'
import Villager from './Villager.jsx'

// One letter per tile:
//   H house (one villager each)   C clinic (2x2 block in the center)
//   P path    T tree    G grass
// There must be exactly 100 H tiles.
const TOWN_MAP = [
  'THHHHPHHHHHT',
  'HHHHHPHHHGHH',
  'HHGHHPHHTHHH',
  'HHHHHPHHHHHH',
  'HTHHPPPPHHHH',
  'PPPPPCCPHHTH',
  'HTHHPCCPPPPP',
  'HHHHPPPPHHHH',
  'HHHHHHPHHHHH',
  'HHHTHHPHHGHH',
  'HHHHHHPHHHHH',
  'THHHHHPHHHHT',
]

// Center of the clinic, in tile units (row 0 / column 0 = top-left corner of the board).
// The clinic is 4 C tiles, so its center is the average of their centers.
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
// results:         runSim(...).villagers for the current toggles, same order as villagers
// baselineResults: runSim(...).villagers with all toggles off (to spot "rescued" villagers)
export default function Board({ villagers, results, baselineResults }) {
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

  const tiles = []
  let nextVillager = 0
  let clinicDrawn = false

  TOWN_MAP.forEach((row, r) => {
    row.split('').forEach((letter, c) => {
      const key = `${r}-${c}`

      if (letter === 'C') {
        // Draw the clinic once, as one tile that spans 2 rows and 2 columns.
        if (!clinicDrawn) {
          clinicDrawn = true
          tiles.push(
            <div
              key={key}
              className="tile clinic"
              style={{ gridRow: `${r + 1} / span 2`, gridColumn: `${c + 1} / span 2` }}
            >
              <span className="clinic-icon">🏥</span>
              <span className="clinic-label">Clinic</span>
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
        tiles.push(<div key={key} className="tile tree">🌳</div>)
        return
      }

      // P path or G grass: plain colored squares
      tiles.push(<div key={key} className={`tile ${letter === 'P' ? 'path' : 'grass'}`} />)
    })
  })

  return <div className="board">{tiles}</div>
}

// scoring.js
// Turns the player's three interpreted policies into game results.
// Pure functions, no React, no AI. Every number here comes from runSim.
//
// ILLUSTRATIVE ONLY. Par and lever sizes are assumptions, not real-world effects.

import { runSim } from './runSim.js'
import { LEVERS, STRENGTHS } from './levers.js'

const strengthRank = (strength) => STRENGTHS.indexOf(strength) // small 0, medium 1, large 2

// ---------------------------------------------------------------------------
// dedupeInterpretations
// interpretations: [{ policyIndex, leverId, strength, reason, note }] (one per policy)
// If two policies map to the same lever, only the stronger one counts
// (on a tie, the earlier policy wins). The loser gets overlapsWith = the
// policyIndex of the winner. Returns a new array plus the active levers list.
// ---------------------------------------------------------------------------
export function dedupeInterpretations(interpretations) {
  const winnerByLever = {} // leverId -> interpretation that counts
  for (const item of interpretations) {
    if (!item.leverId) continue
    const current = winnerByLever[item.leverId]
    if (!current || strengthRank(item.strength) > strengthRank(current.strength)) {
      winnerByLever[item.leverId] = item
    }
  }

  const items = interpretations.map((item) => {
    if (!item.leverId) return { ...item, counts: false, overlapsWith: null }
    const winner = winnerByLever[item.leverId]
    if (winner === item) return { ...item, counts: true, overlapsWith: null }
    return { ...item, counts: false, overlapsWith: winner.policyIndex }
  })

  const levers = items.filter((item) => item.counts).map((item) => ({ id: item.leverId, strength: item.strength }))
  return { items, levers }
}

// ---------------------------------------------------------------------------
// Subgroups shown on the results screen. Structural variables only.
// ---------------------------------------------------------------------------
export const SUBGROUPS = [
  { id: 'noVehicle', label: 'No car at home', test: (v) => v.VEH === 0 },
  { id: 'children', label: 'Kids at home', test: (v) => v.HUPAC !== 4 }, // HUPAC 4 = no children
  { id: 'limitedEnglish', label: 'Limited English', test: (v) => v.ENG >= 2 }, // speaks English "well" or less
]

// Average chance of staying, within one group. results is runSim(...).villagers.
function groupRetention(villagers, results, test) {
  let sum = 0
  let count = 0
  results.forEach((r, i) => {
    if (test(villagers[i])) {
      sum += 1 - r.dropProbability
      count += 1
    }
  })
  return { retention: count > 0 ? sum / count : null, count }
}

// ---------------------------------------------------------------------------
// findPar: the best bundle of 3 different levers, all at medium strength.
// Brute force: try every combination (9 levers -> 84 bundles) and keep the best.
// ---------------------------------------------------------------------------
export function findPar(villagers, protocol, seed) {
  const baseline = runSim(villagers, protocol, [], seed).expectedRetention
  let best = null
  for (let i = 0; i < LEVERS.length; i++) {
    for (let j = i + 1; j < LEVERS.length; j++) {
      for (let k = j + 1; k < LEVERS.length; k++) {
        const levers = [LEVERS[i], LEVERS[j], LEVERS[k]].map((lever) => ({ id: lever.id, strength: 'medium' }))
        const retention = runSim(villagers, protocol, levers, seed).expectedRetention
        if (!best || retention > best.retention) best = { levers, retention }
      }
    }
  }
  return { ...best, gain: best.retention - baseline }
}

// ---------------------------------------------------------------------------
// scoreRound: everything the results screen needs.
//   interpretations: one per policy, from the AI or the offline matcher
//   par:             result of findPar (computed once, it does not change)
// ---------------------------------------------------------------------------
export function scoreRound(villagers, protocol, interpretations, par, seed) {
  const { items, levers } = dedupeInterpretations(interpretations)

  const baseline = runSim(villagers, protocol, [], seed)
  const current = runSim(villagers, protocol, levers, seed)
  const gain = current.expectedRetention - baseline.expectedRetention

  // Leave-one-out: how much retention falls if we take this one policy away.
  const policies = items.map((item) => {
    if (!item.counts) return { ...item, marginal: 0 }
    const without = levers.filter((lever) => lever.id !== item.leverId)
    const retentionWithout = runSim(villagers, protocol, without, seed).expectedRetention
    return { ...item, marginal: current.expectedRetention - retentionWithout }
  })

  const subgroups = SUBGROUPS.map((group) => {
    const before = groupRetention(villagers, baseline.villagers, group.test)
    const after = groupRetention(villagers, current.villagers, group.test)
    return { id: group.id, label: group.label, count: before.count, before: before.retention, after: after.retention }
  })

  // Score: the player's gain as a share of par's gain. Not capped, because
  // "large" policies can beat a par made of "medium" ones.
  const score = par.gain > 0 ? gain / par.gain : 0

  return { baseline, current, gain, policies, subgroups, par, score }
}

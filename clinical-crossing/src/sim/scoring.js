// scoring.js
// Turns the player's three interpreted policies into game results.
// Pure functions, no React, no AI. Every number here comes from runSim.
//
// ILLUSTRATIVE ONLY. Lever sizes are assumptions, not real-world effects.
// There is no single "par": the player sees how their plan did on two goals
// that pull in different directions, compared with every possible plan.

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

// Groups goal: the average retention of the subgroups, each group counted
// EQUALLY no matter how many villagers are in it. So helping the 6 villagers
// with limited English matters as much as helping the 29 with kids at home.
function groupsRetention(villagers, results) {
  let sum = 0
  for (const group of SUBGROUPS) sum += groupRetention(villagers, results, group.test).retention
  return sum / SUBGROUPS.length
}

// The two goals the player is judged on. They pull in different directions:
// broad changes help the most people overall, while targeted ones help the
// groups facing the biggest barriers.
export const GOALS = [
  { id: 'overall', label: 'Everyone', measure: (villagers, run) => run.expectedRetention },
  { id: 'groups', label: 'Groups facing barriers', measure: (villagers, run) => groupsRetention(villagers, run.villagers) },
]

// ---------------------------------------------------------------------------
// allPlans: every bundle of 3 different levers at medium strength
// (9 levers -> 84 bundles), with its gain on each goal. Computed once.
// Used to show the player how their plan compares with every possible plan,
// instead of grading them against one "right answer".
// ---------------------------------------------------------------------------
export function allPlans(villagers, protocol, seed) {
  const baseline = runSim(villagers, protocol, [], seed)
  const plans = []
  for (let i = 0; i < LEVERS.length; i++) {
    for (let j = i + 1; j < LEVERS.length; j++) {
      for (let k = j + 1; k < LEVERS.length; k++) {
        const levers = [LEVERS[i], LEVERS[j], LEVERS[k]].map((lever) => ({ id: lever.id, strength: 'medium' }))
        const run = runSim(villagers, protocol, levers, seed)
        const gains = {}
        for (const goal of GOALS) {
          gains[goal.id] = goal.measure(villagers, run) - goal.measure(villagers, baseline)
        }
        plans.push({ levers, gains })
      }
    }
  }
  return plans
}

// ---------------------------------------------------------------------------
// scoreRound: everything the results screen needs.
//   interpretations: one per policy, from the AI or the offline matcher
//   plans:           result of allPlans (computed once, it does not change)
// ---------------------------------------------------------------------------
export function scoreRound(villagers, protocol, interpretations, plans, seed) {
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

  // For each goal: what the player's plan did, how many of the possible
  // three-lever plans it matched or beat, and which plan does best on that goal.
  // (The player's levers can be "large", so they can beat every medium plan.)
  const goals = GOALS.map((goal) => {
    const playerGain = goal.measure(villagers, current) - goal.measure(villagers, baseline)
    const beats = plans.filter((plan) => playerGain >= plan.gains[goal.id] - 1e-9).length
    const best = plans.reduce((a, b) => (b.gains[goal.id] > a.gains[goal.id] ? b : a))
    return {
      id: goal.id,
      label: goal.label,
      gain: playerGain,
      beats,
      total: plans.length,
      best: { levers: best.levers, gain: best.gains[goal.id] },
    }
  })

  return { baseline, current, gain, policies, subgroups, goals }
}

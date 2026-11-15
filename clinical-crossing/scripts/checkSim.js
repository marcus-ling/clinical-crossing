// checkSim.js
// Plain node checks for the sim. No test framework.
//
// Run with plain node, from any folder:
//   node scripts/checkSim.js              run the checks (from clinical-crossing/)
//   node scripts/checkSim.js --calibrate  find the intercept `a` (then paste it into runSim.js)

import { readFileSync } from 'node:fs'
import { runSim, ASSUMPTIONS } from '../src/sim/runSim.js'

// Find the data files relative to this script, not the folder node was started in.
const villagersUrl = new URL('../public/data/villagers.json', import.meta.url)
const protocolUrl = new URL('../public/protocol.json', import.meta.url)

const villagers = JSON.parse(readFileSync(villagersUrl, 'utf-8'))
const protocol = JSON.parse(readFileSync(protocolUrl, 'utf-8'))

const SEED = 42
const TARGET = 0.87 // published VIVID completion, 365 of 420 (PMC7065168)

// The three original what-if toggles are now levers (see src/sim/levers.js).
// Checked at "large" strength, the closest match to the old on/off switches.
const OFF = []
const WEEKEND = [{ id: 'weekendEveningHours', strength: 'large' }]
const HOME_DRAWS = [{ id: 'homeBloodDraws', strength: 'large' }]
const NO_FASTING = [{ id: 'relaxedFasting', strength: 'large' }]
const ALL_ON = [...WEEKEND, ...HOME_DRAWS, ...NO_FASTING]

// ---------------------------------------------------------------------------
// Calibration: bisection on `a`. Higher `a` means more dropout, so retention
// goes down as `a` goes up. Halve the search range until we hit the target.
// ---------------------------------------------------------------------------
if (process.argv.includes('--calibrate')) {
  let low = -20
  let high = 20
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2
    const retention = runSim(villagers, protocol, OFF, SEED, { ...ASSUMPTIONS, a: mid }).expectedRetention
    if (retention > TARGET) low = mid // too many stay -> raise a
    else high = mid
  }
  const a = (low + high) / 2
  console.log(`Calibrated a = ${a.toFixed(4)} (baseline expectedRetention ${TARGET})`)
  console.log('Paste this into ASSUMPTIONS.a in src/sim/runSim.js')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
let failures = 0
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures += 1
}

const retention = (levers) => runSim(villagers, protocol, levers, SEED).expectedRetention

const baseline = retention(OFF)
const weekend = retention(WEEKEND)
const homeDraws = retention(HOME_DRAWS)
const noFasting = retention(NO_FASTING)
const allOn = retention(ALL_ON)

// 1. Baseline near the published completion rate
check('baseline expectedRetention is between 0.85 and 0.89', baseline >= 0.85 && baseline <= 0.89)

// 2. Each toggle helps (or at least does not hurt); all three is the best
check('weekendVisits alone >= baseline', weekend >= baseline)
check('homeBloodDraws alone >= baseline', homeDraws >= baseline)
check('noFasting alone >= baseline', noFasting >= baseline)
check('all three on is highest', allOn >= weekend && allOn >= homeDraws && allOn >= noFasting)

// 3. Same seed -> identical results
const run1 = runSim(villagers, protocol, OFF, SEED)
const run2 = runSim(villagers, protocol, OFF, SEED)
check('same seed gives identical results', JSON.stringify(run1) === JSON.stringify(run2))

// 4. No vehicle adds burden. Two copies of one villager, only VEH differs.
const withCar = { ...villagers[0], id: 'with-car', VEH: 2 }
const noCar = { ...villagers[0], id: 'no-car', VEH: 0 }
const pair = runSim([withCar, noCar], protocol, OFF, SEED).villagers
check('no vehicle has higher burden than an otherwise identical villager with one', pair[1].burden > pair[0].burden)

// ---------------------------------------------------------------------------
// Retention summary
// ---------------------------------------------------------------------------
const pct = (x) => `${(x * 100).toFixed(1)}%`
const pts = (x) => `${x >= baseline ? '+' : ''}${((x - baseline) * 100).toFixed(1)} pts`
console.log('\nExpected retention (illustrative):')
console.log(`  baseline         ${pct(baseline)}`)
console.log(`  weekendVisits    ${pct(weekend)}  (${pts(weekend)})`)
console.log(`  homeBloodDraws   ${pct(homeDraws)}  (${pts(homeDraws)})`)
console.log(`  noFasting        ${pct(noFasting)}  (${pts(noFasting)})`)
console.log(`  all three on     ${pct(allOn)}  (${pts(allOn)})`)
console.log(`  sampled baseline ${pct(run1.sampledRetention)}  (seed ${SEED}, noisy)`)

// ---------------------------------------------------------------------------
// Subgroup gap: no-vehicle villagers vs the rest, in each scenario.
// Expected retention = average of (1 - dropProbability) within the group.
// ---------------------------------------------------------------------------
const noVehicleIds = new Set(villagers.filter((v) => v.VEH === 0).map((v) => v.id))

function groupRetention(levers) {
  const results = runSim(villagers, protocol, levers, SEED).villagers
  let sumNo = 0
  let sumRest = 0
  for (const r of results) {
    if (noVehicleIds.has(r.id)) sumNo += 1 - r.dropProbability
    else sumRest += 1 - r.dropProbability
  }
  return { noVehicle: sumNo / noVehicleIds.size, rest: sumRest / (results.length - noVehicleIds.size) }
}

const scenarios = [
  ['baseline', OFF],
  ['weekendVisits', WEEKEND],
  ['homeBloodDraws', HOME_DRAWS],
  ['noFasting', NO_FASTING],
  ['all three on', ALL_ON],
]
console.log(`\nNo-vehicle villagers (n=${noVehicleIds.size}) vs the rest (n=${villagers.length - noVehicleIds.size}):`)
for (const [name, levers] of scenarios) {
  const g = groupRetention(levers)
  const gap = ((g.rest - g.noVehicle) * 100).toFixed(1)
  console.log(`  ${name.padEnd(16)} no vehicle ${pct(g.noVehicle)}   rest ${pct(g.rest)}   gap ${gap} pts`)
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)

// checkLevers.js
// Plain node checks for the policy levers, scoring and the AI validator.
// No test framework. Run from clinical-crossing/:
//   node scripts/checkLevers.js

import { readFileSync } from 'node:fs'
import { runSim } from '../src/sim/runSim.js'
import { LEVERS, STRENGTHS } from '../src/sim/levers.js'
import { dedupeInterpretations, findPar, scoreRound } from '../src/sim/scoring.js'
import { validateInterpretation, validatePolicies, validateReply } from '../src/ai/validate.js'
import { matchLocally } from '../src/ai/localMatcher.js'

const villagers = JSON.parse(readFileSync(new URL('../public/data/villagers.json', import.meta.url), 'utf-8'))
const protocol = JSON.parse(readFileSync(new URL('../public/protocol.json', import.meta.url), 'utf-8'))
const SEED = 42

let failures = 0
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures += 1
}

// ---------------------------------------------------------------------------
// 1. Baseline unchanged. These numbers were recorded from the original
//    toggle version of runSim (all toggles off, seed 42) before levers existed.
// ---------------------------------------------------------------------------
const ORIGINAL_EXPECTED = 0.8700047442405225
const ORIGINAL_DROPPED = '5,19,22,24,26,30,37,38,51,56,61,62,67,94,99'

const baseline = runSim(villagers, protocol, [], SEED)
const droppedIds = baseline.villagers.filter((r) => r.dropped).map((r) => r.id).join(',')
check('baseline unchanged (same expected retention and same dropped villagers)',
  baseline.expectedRetention === ORIGINAL_EXPECTED && droppedIds === ORIGINAL_DROPPED)

// ---------------------------------------------------------------------------
// 2. Each lever alone, at every strength, is at least as good as baseline,
//    and a stronger lever is at least as good as a weaker one.
// ---------------------------------------------------------------------------
let eachOk = true
for (const lever of LEVERS) {
  let previous = baseline.expectedRetention
  for (const strength of STRENGTHS) {
    const r = runSim(villagers, protocol, [{ id: lever.id, strength }], SEED).expectedRetention
    if (r < previous) {
      eachOk = false
      console.log(`      ${lever.id} ${strength} went down: ${r}`)
    }
    previous = r
  }
}
check('each lever alone >= baseline (and small <= medium <= large)', eachOk)

// ---------------------------------------------------------------------------
// 3. Deterministic: same levers + same seed -> identical output.
// ---------------------------------------------------------------------------
const someLevers = [
  { id: 'transportSupport', strength: 'large' },
  { id: 'childcareSupport', strength: 'small' },
  { id: 'paidLeave', strength: 'medium' },
]
const runA = runSim(villagers, protocol, someLevers, SEED)
const runB = runSim(villagers, protocol, someLevers, SEED)
check('deterministic with the same seed', JSON.stringify(runA) === JSON.stringify(runB))

// ---------------------------------------------------------------------------
// 4. Duplicate-lever dedupe: two policies on the same lever, the stronger wins
//    and the other is marked as overlapping.
// ---------------------------------------------------------------------------
const dupes = [
  { policyIndex: 0, leverId: 'transportSupport', strength: 'small', reason: 'bus passes', note: null },
  { policyIndex: 1, leverId: 'childcareSupport', strength: 'medium', reason: 'childcare', note: null },
  { policyIndex: 2, leverId: 'transportSupport', strength: 'large', reason: 'free rides', note: null },
]
const deduped = dedupeInterpretations(dupes)
const dedupeOk =
  deduped.levers.length === 2 &&
  deduped.levers.some((l) => l.id === 'transportSupport' && l.strength === 'large') &&
  deduped.items[0].counts === false &&
  deduped.items[0].overlapsWith === 2 &&
  deduped.items[2].counts === true
// runSim itself also keeps only the stronger copy if it is ever handed both.
const simDedupeOk =
  runSim(villagers, protocol, [dupes[0], dupes[2]].map((d) => ({ id: d.leverId, strength: d.strength })), SEED).expectedRetention ===
  runSim(villagers, protocol, [{ id: 'transportSupport', strength: 'large' }], SEED).expectedRetention
check('duplicate-lever dedupe keeps only the stronger policy', dedupeOk && simDedupeOk)

// ---------------------------------------------------------------------------
// 5. The validator rejects a lever id that is not in the closed list
//    (and a bad strength, an overlong reason, a number in the reason, and
//    an extra numeric field).
// ---------------------------------------------------------------------------
const bad = validateInterpretation({ leverId: 'cashBonus', strength: 'large', reason: 'pay people', note: null }, 0)
const badStrength = validateInterpretation({ leverId: 'paidLeave', strength: 'huge', reason: 'ok', note: null }, 0)
const longReason = validateInterpretation({ leverId: 'paidLeave', strength: 'small', reason: 'x'.repeat(141), note: null }, 0)
const good = validateInterpretation({ leverId: 'paidLeave', strength: 'small', reason: 'Covers lost wages', effect: 40 }, 0)
const numberInReason = validateInterpretation({ leverId: 'paidLeave', strength: 'small', reason: 'Adds 5% retention' }, 0)
const reply = validateReply({ interpretations: [{ policyIndex: 1, leverId: 'nope', strength: 'small', reason: 'x' }] })
check('invalid leverId is rejected by the validator',
  bad.leverId === null && badStrength.leverId === null && longReason.leverId === null && numberInReason.leverId === null &&
  good.leverId === 'paidLeave' && !('effect' in good) &&
  reply.length === 3 && reply.every((r) => r.leverId === null))

// Request checks (not in the required list, but cheap to test).
check('policy request validation (exactly 3 strings, 1-200 chars)',
  validatePolicies(['a', 'b', 'c']) !== null &&
  validatePolicies(['a', 'b']) === null &&
  validatePolicies(['a', 'b', '   ']) === null &&
  validatePolicies(['a', 'b', 'x'.repeat(201)]) === null &&
  validatePolicies(['a', 'b', 3]) === null)

// ---------------------------------------------------------------------------
// 6. Par is computed: 3 different levers, all medium, better than baseline,
//    and no other medium bundle beats it.
// ---------------------------------------------------------------------------
const par = findPar(villagers, protocol, SEED)
const parIds = new Set(par.levers.map((l) => l.id))
check('par is computed (3 distinct medium levers, gain > 0)',
  par.levers.length === 3 && parIds.size === 3 && par.levers.every((l) => l.strength === 'medium') && par.gain > 0)

// Offline matcher sanity (also not required, but it guards the fallback).
const matched = matchLocally(['free bus passes and rides', 'childcare during visits', 'pay people $1000 to join'])
check('offline matcher returns 3 valid answers',
  matched.length === 3 && matched[0].leverId === 'transportSupport' &&
  matched[1].leverId === 'childcareSupport' && matched[2].leverId === null && matched[2].note !== null)

// ---------------------------------------------------------------------------
// Summary (illustrative numbers)
// ---------------------------------------------------------------------------
const pts = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} pts`
console.log('\nEach lever alone, medium strength (illustrative):')
for (const lever of LEVERS) {
  const r = runSim(villagers, protocol, [{ id: lever.id, strength: 'medium' }], SEED).expectedRetention
  console.log(`  ${lever.id.padEnd(20)} ${pts(r - baseline.expectedRetention)}`)
}
console.log(`\nPar: ${par.levers.map((l) => l.id).join(' + ')}  ${pts(par.gain)}`)

const round = scoreRound(villagers, protocol, dupes, par, SEED)
console.log(`Example round (the dedupe test above): ${pts(round.gain)}, score ${Math.round(round.score * 100)}% of par`)
for (const p of round.policies) console.log(`  policy ${p.policyIndex + 1}: ${p.leverId} ${p.strength}  marginal ${pts(p.marginal)}${p.overlapsWith !== null ? `  (overlaps policy ${p.overlapsWith + 1})` : ''}`)
for (const g of round.subgroups) console.log(`  ${g.label.padEnd(16)} n=${String(g.count).padEnd(3)} ${pts(g.after - g.before)}`)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)

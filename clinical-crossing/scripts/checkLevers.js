// checkLevers.js
// Plain node checks for the policy levers, scoring and the AI validator.
// No test framework. Run from clinical-crossing/:
//   node scripts/checkLevers.js

import { readFileSync } from 'node:fs'
import { runSim } from '../src/sim/runSim.js'
import { LEVERS, STRENGTHS } from '../src/sim/levers.js'
import { GOALS, allPlans, dedupeInterpretations, scoreRound } from '../src/sim/scoring.js'
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
// 6. All plans: 84 bundles of 3 distinct medium levers, each with a gain on
//    every goal. The two goals should NOT share the same best plan, otherwise
//    the game is back to one fixed "right answer".
// ---------------------------------------------------------------------------
const plans = allPlans(villagers, protocol, SEED)
const bestFor = (goalId) => plans.reduce((a, b) => (b.gains[goalId] > a.gains[goalId] ? b : a))
const planKey = (plan) => plan.levers.map((l) => l.id).sort().join('+')
check('all 84 plans computed (3 distinct medium levers each)',
  plans.length === 84 && plans.every((p) => new Set(p.levers.map((l) => l.id)).size === 3 && p.levers.every((l) => l.strength === 'medium')))
check('the two goals have different best plans',
  GOALS.length === 2 && planKey(bestFor('overall')) !== planKey(bestFor('groups')))

// 7. Lever mechanics: levers that used to be identical now differ, and they
//    reach the people the lever description says they do.
const one = (id, strength = 'medium') => runSim(villagers, protocol, [{ id, strength }], SEED)
const travelGains = ['homeBloodDraws', 'moreTelephoneVisits', 'satelliteClinic'].map((id) => one(id).expectedRetention)
check('home draws, phone visits and satellite clinic no longer give identical results',
  new Set(travelGains).size === 3)
// Phone visits don't reach limited-English villagers on their own, but do when interpreters are added.
const limitedIdx = villagers.map((v, i) => (v.ENG >= 3 ? i : -1)).filter((i) => i >= 0)
const travelOf = (run) => limitedIdx.reduce((s, i) => s + run.villagers[i].burden, 0)
const withPhone = runSim(villagers, protocol, [{ id: 'moreTelephoneVisits', strength: 'large' }], SEED)
const withPhoneAndInterp = runSim(villagers, protocol, [{ id: 'moreTelephoneVisits', strength: 'large' }, { id: 'languageSupport', strength: 'small' }], SEED)
const interpOnly = runSim(villagers, protocol, [{ id: 'languageSupport', strength: 'small' }], SEED)
check('phone visits reach limited-English villagers only with interpreters',
  limitedIdx.length > 0 &&
  travelOf(withPhone) === travelOf(baseline) &&
  travelOf(withPhoneAndInterp) < travelOf(interpOnly))
// Paid leave only helps people who work.
const paid = one('paidLeave', 'large')
check('paid leave changes nothing for people who do not work',
  villagers.every((v, i) => v.WKHP > 0 || paid.villagers[i].burden === baseline.villagers[i].burden))

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
for (const goal of GOALS) {
  const best = bestFor(goal.id)
  console.log(`Best plan for "${goal.label}": ${best.levers.map((l) => l.id).join(' + ')}  ${pts(best.gains[goal.id])}`)
}

const round = scoreRound(villagers, protocol, dupes, plans, SEED)
console.log(`\nExample round (the dedupe test above): ${pts(round.gain)}`)
for (const g of round.goals) console.log(`  ${g.label}: ${pts(g.gain)}, matches or beats ${g.beats} of ${g.total} plans`)
for (const p of round.policies) console.log(`  policy ${p.policyIndex + 1}: ${p.leverId} ${p.strength}  marginal ${pts(p.marginal)}${p.overlapsWith !== null ? `  (overlaps policy ${p.overlapsWith + 1})` : ''}`)
for (const g of round.subgroups) console.log(`  ${g.label.padEnd(16)} n=${String(g.count).padEnd(3)} ${pts(g.after - g.before)}`)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)

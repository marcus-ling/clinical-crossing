// validate.js
// Checks on both sides of the AI interpreter. Plain JavaScript, no
// dependencies, so the browser, the server function and the check scripts
// can all import it.
//
// The rule: the AI may only pick a lever id from the closed list and a
// strength word. Anything else is thrown away and that policy counts as
// "not matched". The AI never sets a number.

import { LEVER_IDS, STRENGTHS } from '../sim/levers.js'

export const POLICY_COUNT = 3
export const MAX_POLICY_CHARS = 200
export const MAX_REASON_CHARS = 140
export const MAX_NOTE_CHARS = 200

// ---------------------------------------------------------------------------
// The request: exactly 3 strings, each 1 to 200 characters (after trimming).
// Returns the trimmed policies, or null if the request is not valid.
// ---------------------------------------------------------------------------
export function validatePolicies(policies) {
  if (!Array.isArray(policies) || policies.length !== POLICY_COUNT) return null
  const trimmed = []
  for (const text of policies) {
    if (typeof text !== 'string') return null
    const t = text.trim()
    if (t.length < 1 || t.length > MAX_POLICY_CHARS) return null
    trimmed.push(t)
  }
  return trimmed
}

// An empty "not matched" answer for one policy.
export function unmatched(policyIndex, note = null) {
  return { policyIndex, leverId: null, strength: null, reason: null, note }
}

// A short piece of AI-written text, or null. Text with digits or "%" is
// thrown away, so the AI can't sneak a number into the game ("+5% retention").
// All numbers on screen must come from the simulation.
function shortText(value, max) {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (t.length === 0 || t.length > max || /[0-9%]/.test(t)) return null
  return t
}

// ---------------------------------------------------------------------------
// One interpreted policy from the model (or the offline matcher).
// Keeps it only if leverId is in the closed list, strength is one of the
// three words, and the reason fits. Otherwise returns "not matched".
// ---------------------------------------------------------------------------
export function validateInterpretation(item, policyIndex) {
  if (!item || typeof item !== 'object') return unmatched(policyIndex)
  const note = shortText(item.note, MAX_NOTE_CHARS)

  // The model chose "no lever" on purpose: keep its note.
  if (item.leverId === null || item.leverId === undefined) return unmatched(policyIndex, note)

  const leverOk = typeof item.leverId === 'string' && LEVER_IDS.includes(item.leverId)
  const strengthOk = STRENGTHS.includes(item.strength)
  const reason = shortText(item.reason, MAX_REASON_CHARS)
  if (!leverOk || !strengthOk || !reason) return unmatched(policyIndex)

  return { policyIndex, leverId: item.leverId, strength: item.strength, reason, note }
}

// ---------------------------------------------------------------------------
// The whole reply: { interpretations: [...] }. Always returns exactly 3
// cleaned items, one per policy index 0, 1, 2, whatever the model sent.
// ---------------------------------------------------------------------------
export function validateReply(reply) {
  const list = reply && Array.isArray(reply.interpretations) ? reply.interpretations : []
  const result = []
  for (let i = 0; i < POLICY_COUNT; i++) {
    const item = list.find((x) => x && x.policyIndex === i)
    result.push(validateInterpretation(item, i))
  }
  return result
}

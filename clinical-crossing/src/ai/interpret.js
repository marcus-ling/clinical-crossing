// interpret.js (browser side)
// Sends the player's three policies to our serverless function, which asks
// Gemini what each one means. If ANYTHING goes wrong (no key, no network,
// timeout, a strange reply) we quietly use the offline keyword matcher
// instead, so the game never breaks.
//
// Either way the result is only a lever id + a strength word per policy.
// All numbers come from the simulation, never from the AI.

import { matchLocally } from './localMatcher.js'
import { validateReply } from './validate.js'

const ENDPOINT = '/api/interpret'
// A little longer than the server's 8-second limit, so the server gets to answer first.
const CLIENT_TIMEOUT_MS = 10000

// policies: 3 trimmed strings.
// Returns { interpretations: [3 items], source: 'ai' | 'offline' }.
export async function interpretPolicies(policies) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)
    let reply
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policies }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error('interpreter unavailable')
      reply = await res.json()
    } finally {
      clearTimeout(timer)
    }

    if (!reply || !Array.isArray(reply.interpretations) || reply.interpretations.length !== policies.length) {
      throw new Error('unexpected reply')
    }
    // The server already validated, but check again: never trust the wire.
    return { interpretations: validateReply(reply), source: 'ai' }
  } catch {
    return { interpretations: matchLocally(policies), source: 'offline' }
  }
}

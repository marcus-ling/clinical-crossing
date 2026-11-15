// localMatcher.js
// The offline backup for the AI interpreter. Simple keyword matching, no
// network. Returns the same shape as the Gemini function, so the game works
// the same either way, just less cleverly.
// It always picks "medium": keywords can't tell how strong a policy is.

import { LEVERS } from '../sim/levers.js'
import { unmatched, validateInterpretation } from './validate.js'

// Words that point at each lever. Lowercase, matched as whole words (an
// "s" or "es" on the end is fine), so "car" does not match "childcare" but
// "rides" matches "ride". A trailing * means "starts with", so "translat*"
// matches translate, translator, translation.
// A policy can hit several levers; the one with the most keyword hits wins
// (ties: first in LEVERS).
const KEYWORDS = {
  weekendEveningHours: ['weekend', 'saturday', 'sunday', 'evening', 'night', 'after work', 'after-hours', 'after hours', 'flexible hours', 'flexible scheduling', 'early morning', 'extended hours'],
  paidLeave: ['paid leave', 'paid time off', 'pto', 'time off', 'wage', 'lost pay', 'lost income', 'lost wages', 'compensate for work', 'employer', 'sick leave', 'reimburse time'],
  homeBloodDraws: ['home blood', 'home draw', 'blood draw at home', 'home visit', 'mobile lab', 'mobile nurse', 'mobile phlebotomy', 'phlebotom*', 'at-home', 'at home', 'nurse visit', 'come to them', 'house call'],
  moreTelephoneVisits: ['telephone', 'phone', 'video', 'telehealth', 'telemedicine', 'virtual', 'remote visit', 'online visit', 'zoom', 'call instead'],
  satelliteClinic: ['satellite', 'closer clinic', 'nearby clinic', 'local clinic', 'pharmacy', 'community clinic', 'second site', 'another site', 'more sites', 'closer to home', 'neighborhood', 'community center'],
  relaxedFasting: ['fasting', 'fast', 'non-fasting', 'nonfasting', 'breakfast', 'skip fasting'],
  transportSupport: ['ride', 'transport', 'bus', 'uber', 'lyft', 'taxi', 'cab', 'shuttle', 'car', 'parking', 'gas money', 'mileage', 'transit', 'travel cost', 'travel reimburse'],
  childcareSupport: ['childcare', 'child care', 'babysit', 'daycare', 'day care', 'kids', 'children', 'child', 'nanny', 'play area', 'kid'],
  languageSupport: ['interpret*', 'translat*', 'language', 'spanish', 'arabic', 'bilingual', 'multilingual', 'english', 'non-english'],
}

// Things this simulator deliberately does not model: weakening safety,
// consent or data quality, or paying people a lot to join.
const OUT_OF_SCOPE = [
  /skip (the )?(safety|consent)/,
  /(no|without|drop|remove|skip|fewer|less) (safety|consent|monitoring|checks?|labs? tests?)/,
  /informed consent/,
  /\bfake|falsif|make up data|\blie\b/,
  /\$\s?\d{3,}/, // "$500", "$ 1000"
  /(pay|paying) (people|participants|them|patients)( a lot| more| big| extra)?( money)? to (join|enroll|stay|sign)/,
  /(big|huge|large|cash) (bonus|incentive|payment)/,
]

const OUT_OF_SCOPE_NOTE =
  "That's outside what this little town models. We only look at everyday barriers like travel, work, kids and language, not changes to safety, consent or big payments."

const NO_MATCH_NOTE =
  "I couldn't tie that to a barrier the town keeps track of. Try naming the specific problem you're fixing, like getting there, time off work, kids or language."

// Finds `word` in `text` and returns it as the player wrote it (e.g. "rides"),
// or null if it is not there.
function findWord(text, word) {
  const isStem = word.endsWith('*')
  // Escape regex symbols (none of our keywords use them, but just in case).
  const plain = (isStem ? word.slice(0, -1) : word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const ending = isStem ? '\\w*' : '(?:e?s)?\\b' // stems: any ending; words: optional plural
  const match = text.match(new RegExp(`\\b${plain}${ending}`))
  return match ? match[0] : null
}

// policies: array of 3 strings. Returns 3 interpretations.
export function matchLocally(policies) {
  return policies.map((text, policyIndex) => {
    const lower = String(text).toLowerCase()

    if (OUT_OF_SCOPE.some((pattern) => pattern.test(lower))) {
      return unmatched(policyIndex, OUT_OF_SCOPE_NOTE)
    }

    let bestId = null
    let bestWords = []
    for (const lever of LEVERS) {
      const words = KEYWORDS[lever.id].map((word) => findWord(lower, word)).filter(Boolean)
      if (words.length > bestWords.length) {
        bestId = lever.id
        bestWords = words
      }
    }
    if (!bestId) return unmatched(policyIndex, NO_MATCH_NOTE)

    // e.g. 'You mentioned "bus" and "rides".' (no repeats, at most two words)
    const quoted = [...new Set(bestWords)].slice(0, 2).map((word) => `"${word}"`)
    return validateInterpretation(
      {
        leverId: bestId,
        strength: 'medium',
        reason: `You mentioned ${quoted.join(' and ')}.`,
        note: null,
      },
      policyIndex,
    )
  })
}

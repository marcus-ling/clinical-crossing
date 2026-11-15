// droidStories.mjs
// Build-time script: asks Factory Droid to write a one-sentence story for each
// villager, checks every story, and saves them to public/data/stories.json.
//
// Run from clinical-crossing/:
//   npm run stories
// (which runs: node --env-file=.env scripts/droidStories.mjs)
//
// NOTE: @factory/droid-sdk was uninstalled on 2026-11-15 (sponsored access
// ended; it also pulled in a vulnerable zod 3). stories.json is already
// generated and the app does not need the SDK. To regenerate stories:
//   npm install --save-dev @factory/droid-sdk   (and set FACTORY_API_KEY in .env)
//
// The Droid SDK reads FACTORY_API_KEY from the environment by itself.
// This script never reads, logs, or writes the key.
//
// Stories are ILLUSTRATIVE FICTION built only from census-derived fields.
// The browser app never imports the SDK; it only reads the JSON this writes.
//
// How we avoid repetitive stories WITHOUT inventing facts:
//   - Code (not the model) gives each villager a voice, a focus burden and a
//     target length, using a seeded random generator so runs are repeatable.
//   - Villagers are shuffled into small batches of 10, one fresh Droid session each.
//   - A ban list of overused phrases goes into the prompt AND the validator.
//   - The validator rejects overused openings, overused 4-word phrases and
//     near-duplicates, then retries only the failing ids (at most 2 times).

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, AutonomyLevel } from '@factory/droid-sdk/node'
import { runSim, BURDEN_LABELS } from '../src/sim/runSim.js'
import { toWords, openingOf, phrasesOf, measure, printMetrics } from './storyMetrics.mjs'

const BATCH_SIZE = 10
const MAX_WORDS = 25
const MAX_RETRIES = 2 // extra attempts for failing ids, after the first try
const SEED = 2026 // change this to get a different (but still repeatable) mix

// Variety limits (see storyMetrics.mjs for how phrases are counted).
const OPENING_SHARE_LIMIT = 0.1 // no two-word opening in more than 10% of stories
const PHRASE4_LIMIT = 5 // no 4-word phrase in more than 5 stories
const NEAR_DUPLICATE = 0.5 // share of shared 3-word phrases that counts as a copy

// Schedule numbers from protocol.json that any story may mention.
const SCHEDULE = { totalVisits: 17, officeVisits: 7, phoneVisits: 6, weeks: 29 }

// Find the data files relative to this script, not the folder node was started in.
const villagersUrl = new URL('../public/data/villagers.json', import.meta.url)
const protocolUrl = new URL('../public/protocol.json', import.meta.url)
const outputUrl = new URL('../public/data/stories.json', import.meta.url)

const villagers = JSON.parse(readFileSync(villagersUrl, 'utf-8'))
const protocol = JSON.parse(readFileSync(protocolUrl, 'utf-8'))

const OPENING_LIMIT = Math.floor(OPENING_SHARE_LIMIT * villagers.length) // 10 for 100 villagers

// ---------------------------------------------------------------------------
// 1. Seeded random numbers (mulberry32, same idea as runSim.js)
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let t = seed >>> 0
  return function () {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
const random = mulberry32(SEED)
const pick = (list) => list[Math.floor(random() * list.length)]
const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1))

// Fisher-Yates shuffle (returns a new array).
function shuffle(list) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// ---------------------------------------------------------------------------
// 2. Build the structured fields for each villager (nothing else is sent).
// ---------------------------------------------------------------------------

// Baseline run: no policy levers ([]), same seed as the demo.
// runSim only lists burdens that are bigger than zero, so every burden here is real.
const baseline = runSim(villagers, protocol, [], 42)
const topBurdensById = {}
for (const r of baseline.villagers) {
  topBurdensById[r.id] = r.topBurdens.map((name) => BURDEN_LABELS[name])
}

// PUMS ENG codes in plain words.
const ENGLISH_LABELS = {
  0: 'speaks only English',
  1: 'very well',
  2: 'well',
  3: 'not well',
  4: 'not at all',
}

// Tone only. A voice changes HOW something is said, never WHAT is true.
const VOICES = {
  'matter-of-fact': 'plain and factual, no emotion words',
  tired: 'a little weary, like the schedule wears on them',
  wry: 'dry, lightly ironic, never jokey or mean',
  practical: 'focused on how they would fit it in or work around it',
  hopeful: 'wants to make it work despite the burden',
  brief: 'clipped and short',
}

// Income band from PINCP (personal income, dollars). Only the band is sent,
// never the dollar amount. The cutoffs are an ASSUMPTION for wording only.
function incomeBand(v) {
  if (v.PINCP <= 0) return 'no personal income'
  if (v.PINCP < 30000) return 'lower income'
  if (v.PINCP < 75000) return 'middle income'
  return 'higher income'
}

// Limited English: same cutoff where runSim starts scoring a language burden (ENG 2+).
const limitedEnglish = (v) => v.ENG >= 2

// Generic worries many people have about joining ANY trial. These are not in
// the census data: code assigns them at random, so they are illustrative only.
// None of them may be tied to race, ethnicity, religion or history.
const WORRIES = [
  'getting a placebo instead of the real treatment, because the group is chosen at random',
  'possible side effects of an experimental treatment',
  'being treated like a test subject rather than a person',
  'long, hard-to-read consent paperwork',
  'not hearing back from the study team between visits',
  'never having heard of trials like this until now',
  'nobody at their usual clinic ever mentioning trials',
  'not being sure the research system has their interests at heart',
]

// Every kind of focus a story can have, with how often to pick it.
// eligible(v) says whether the villager's own facts support that kind.
// text(v) is the focus instruction sent to the model.
const FOCUS_KINDS = [
  {
    kind: 'burden', // one of their sim burdens (top or second)
    weight: 35,
    eligible: () => true,
    text: (v) => {
      const burdens = topBurdensById[v.id]
      return burdens.length > 1 && random() < 0.5 ? burdens[1] : burdens[0]
    },
  },
  {
    kind: 'money', // costs that follow from their own fields
    weight: 20,
    eligible: (v) => v.WKHP > 0 || v.HUPAC !== 4 || v.JWMNP > 0,
    text: (v) => {
      const parts = [incomeBand(v)]
      if (v.WKHP > 0) parts.push('missed work hours may mean missed pay')
      if (v.HUPAC !== 4) parts.push('childcare during visits can cost money')
      if (v.JWMNP > 0) parts.push(v.VEH > 0 ? 'gas and parking for clinic trips' : 'fares or rides for clinic trips')
      return `money: ${parts.join('; ')}`
    },
  },
  {
    kind: 'trial demands', // facts from protocol.json, the same for everyone
    weight: 15,
    eligible: () => true,
    text: () =>
      `the trial's own demands: ${SCHEDULE.totalVisits} visits over about ${SCHEDULE.weeks} weeks, ` +
      'some study tasks must be done on their own with nobody allowed to do them for them, ' +
      'and some lab visits may require fasting',
  },
  {
    kind: 'communication', // only when the data says English is limited
    weight: 10,
    eligible: limitedEnglish,
    text: () => 'communication: following phone check-ins, instructions and trial paperwork with limited English',
  },
  {
    kind: 'worry', // illustrative, NOT from the data
    weight: 20,
    eligible: () => true,
    text: () => `worry: ${worryDeck.pop()}`, // dealt from the deck built below
  },
]

// Weighted random pick among the focus kinds this villager is eligible for.
// Villagers with limited English ALWAYS get the communication focus.
function pickFocusKind(v) {
  if (limitedEnglish(v)) return FOCUS_KINDS.find((f) => f.kind === 'communication')
  const options = FOCUS_KINDS.filter((f) => f.eligible(v) && f.kind !== 'communication')
  const total = options.reduce((sum, f) => sum + f.weight, 0)
  let roll = random() * total
  for (const f of options) {
    roll -= f.weight
    if (roll < 0) return f
  }
  return options[options.length - 1]
}

// Build a shuffled "deck" of worries with roughly equal counts, plus a little
// variation so some worries are more common than others (and the player has
// something to prioritize). Example with 24 worry villagers and 8 worries:
// everyone starts at 3, then a few random moves give counts like 2, 3, 4, 5.
const WORRY_SHIFTS = 4 // how many times one villager moves from one worry to another
function buildWorryDeck(count) {
  const counts = WORRIES.map(() => Math.floor(count / WORRIES.length))
  // Hand out the leftover villagers one at a time to random worries.
  for (let i = 0; i < count % WORRIES.length; i++) counts[Math.floor(random() * WORRIES.length)]++
  // Random variation: move one villager from one worry to another (never below 1).
  for (let i = 0; i < WORRY_SHIFTS; i++) {
    const from = Math.floor(random() * WORRIES.length)
    const to = Math.floor(random() * WORRIES.length)
    if (from !== to && counts[from] > 1) {
      counts[from]--
      counts[to]++
    }
  }
  const deck = []
  WORRIES.forEach((w, i) => {
    for (let n = 0; n < counts[i]; n++) deck.push(w)
  })
  return shuffle(deck)
}

// Give every villager a voice, a focus and a target length (in id order, so
// the same seed always gives the same assignment).
// Pass 1 picks the KIND of focus; pass 2 fills in the focus text, after we
// know how many worry villagers there are so the worry deck can be built.
const styleById = {}
for (const v of villagers) {
  const voice = pick(Object.keys(VOICES))
  const focusKind = pickFocusKind(v)
  const targetWords = voice === 'brief' ? randomInt(8, 12) : randomInt(10, MAX_WORDS)
  styleById[v.id] = { voice, focusKind: focusKind.kind, targetWords }
}
const worryCount = villagers.filter((v) => styleById[v.id].focusKind === 'worry').length
const worryDeck = buildWorryDeck(worryCount)
for (const v of villagers) {
  const style = styleById[v.id]
  style.focus = FOCUS_KINDS.find((f) => f.kind === style.focusKind).text(v)
}

// Show the mix so it's easy to check (no personal data, just counts).
const tally = (list) => list.reduce((t, x) => ({ ...t, [x]: (t[x] ?? 0) + 1 }), {})
console.log('Focus kinds:', tally(villagers.map((v) => styleById[v.id].focusKind)))
console.log('Worries:', tally(villagers.filter((v) => styleById[v.id].focusKind === 'worry').map((v) => styleById[v.id].focus.slice(7))))

function fieldsFor(v) {
  const style = styleById[v.id]
  return {
    id: v.id,
    age: v.AGEP,
    commute_minutes: v.JWMNP,
    has_vehicle: v.VEH > 0,
    has_children_at_home: v.HUPAC !== 4, // same rule as runSim
    work_hours: v.WKHP,
    english_proficiency: ENGLISH_LABELS[v.ENG] ?? 'unknown',
    income_band: incomeBand(v),
    topBurdens: topBurdensById[v.id],
    focus: style.focus,
    voice: `${style.voice} (${VOICES[style.voice]})`,
    target_words: style.targetWords,
  }
}

// ---------------------------------------------------------------------------
// 3. Ban list: the most repeated phrases from the first run (npm run
//    stories:metrics on the old stories.json), plus the burden labels copied
//    word for word. Used in the prompt AND the validator.
// ---------------------------------------------------------------------------

const BANNED_PHRASES = [
  // top 3-word phrases
  'children at home', '7 office visits', 'seven office visits', 'and office visits',
  'while fasting labs', 'visits take time', 'clash with my', 'fasting labs clash',
  'labs clash with', 'clinic trips and', 'trips and office',
  // top 4-word phrases
  'fasting labs clash with', 'trips and office visits', 'labs clash with my',
  '20-minute clinic trips and', 'and office visits take', '20-minute trips each way',
  '20-minute trip each way', 'office visits take time', 'with my work schedule',
  'for 7 office visits',
  // burden labels copied word for word
  'travel and visit time', 'lost work hours', 'language barrier',
]

// True if the story contains the phrase as whole words.
function hasPhrase(story, phrase) {
  return ` ${toWords(story).join(' ')} `.includes(` ${phrase} `)
}

// ---------------------------------------------------------------------------
// 4. The prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You write short, illustrative first-person lines for characters in a clinical trial simulation game.
You never use tools, never read or write files, and never run commands. You only reply with JSON.`

// batch: villagers to write for. feedback: {id: "why the last try failed"}.
// avoidOpenings: openings that are already used too often.
function buildPrompt(batch, feedback, avoidOpenings) {
  const items = batch.map((v) => {
    const f = fieldsFor(v)
    if (feedback[v.id]) f.previous_attempt_problem = feedback[v.id]
    return f
  })

  return `Here is a JSON list of fictional villagers. Each has only these facts:
- age (years)
- commute_minutes (roughly how long their one-way trip to the clinic takes)
- has_vehicle (true/false)
- has_children_at_home (true/false)
- work_hours (hours worked per week; 0 means they do not work)
- english_proficiency (how well they speak English)
- income_band (rough personal income level; never turn it into a dollar amount)
- topBurdens (the biggest ways the trial schedule weighs on them, biggest first)

Each villager also has writing instructions (these are NOT facts about them):
- focus: what this story is mainly about. It is one of these kinds:
  * a burden from their topBurdens
  * "money: ..." costs that follow from their facts
  * "the trial's own demands: ..." facts about this trial that apply to everyone
  * "communication: ..." trouble following the trial in English
  * "worry: ..." a common worry people have about joining a trial
- voice: the tone to write in
- target_words: aim for about this many words
- previous_attempt_problem (only sometimes): why their last story was rejected; fix it

The trial: ${SCHEDULE.totalVisits} visits in total (${SCHEDULE.officeVisits} confirmed office visits and ${SCHEDULE.phoneVisits} telephone visits among them) over about ${SCHEDULE.weeks} weeks.

For EACH villager write one story with these rules:
- Exactly one sentence, at most ${MAX_WORDS} words, written in first person ("I", "my", "me").
- About what makes joining or staying in the trial hard for them, mainly through their focus.
- Describe the focus in your own everyday words. Do not copy the focus or burden label text.
- Only mention driving, the commute, travel or trip length when the focus is about travel or travel costs.
- If the focus starts with "worry:", write it as a worry or question about joining ("what if...", "I'd wonder whether..."),
  never as something that already happened to them. Never link a worry to race, ethnicity, religion, or history.
- Use only the supplied facts. Do not invent jobs, places, family details, health details, or events.
- Tone may follow the assigned voice, but add no new facts.
- Do not include names, race, ethnicity, nationality, religion, diagnoses, diseases, medications, or medical advice.
- Never use these words: drug, drugs, medicine, medication, doctor, dose, insulin, diabetes (say "treatment", "clinic", "study team" instead).
- Do not use any number unless it is one of that villager's supplied numbers or a trial number above. No dollar amounts.
- Do not start most stories with "My" followed by the commute time.

Variety rules (important):
- Every story in this list must start with a DIFFERENT first word from the others in this list.
- Every story must use a different sentence structure from the others in this list
  (for example: start with the burden, start with a time, start with "I", start with a contrast word, start with what they would need).
- Never use any of these overused phrases: ${BANNED_PHRASES.map((p) => `"${p}"`).join(', ')}.${
    avoidOpenings.length > 0
      ? `\n- Never start a story with any of these openings, they are used up: ${avoidOpenings.map((p) => `"${p}"`).join(', ')}.`
      : ''
  }

Reply with ONLY a JSON array, no prose and no code fences, in this exact shape:
[{"id": 1, "story": "..."}, ...]
Include every id below exactly once.

Villagers:
${JSON.stringify(items, null, 2)}`
}

// ---------------------------------------------------------------------------
// 5. Validation, part 1: SAFETY rules. A story that breaks any of these is
//    never kept, no matter how many retries fail.
// ---------------------------------------------------------------------------

// Words we never want in a story (whole-word, case-insensitive).
const BANNED_WORDS = [
  // race / ethnicity
  'race', 'racial', 'ethnic', 'ethnicity', 'white', 'black', 'asian', 'hispanic',
  'latino', 'latina', 'latinx', 'african', 'caucasian', 'arab', 'indigenous', 'native',
  // nationality / immigration
  'nationality', 'american', 'mexican', 'immigrant', 'immigrants', 'citizen', 'citizenship', 'foreigner',
  // religion
  'religion', 'religious', 'church', 'mosque', 'temple', 'synagogue', 'christian', 'muslim',
  'jewish', 'hindu', 'buddhist', 'god', 'pray', 'prayer', 'faith', 'sabbath',
  // history / discrimination (worries must stay generic, never tied to group history)
  'history', 'historical', 'racism', 'racist', 'discrimination', 'tuskegee', 'segregation',
  // diagnoses / medical advice
  'diabetes', 'diabetic', 'insulin', 'glucose', 'diagnosis', 'diagnosed', 'disease', 'illness',
  'cancer', 'medication', 'medications', 'medicine', 'prescription', 'dose', 'dosage', 'drug',
  'drugs', 'symptom', 'symptoms', 'doctor',
]
const BANNED_RE = new RegExp(`\\b(${BANNED_WORDS.join('|')})\\b`, 'i')

// Spelled-out numbers. "one" is left out because it is used as a normal word.
const NUMBER_WORDS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, dozen: 12,
}

// For compound numbers like "twenty-five" or "forty one".
const UNIT_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }
const COMPOUND_NUMBER_RE = new RegExp(
  `\\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](${Object.keys(UNIT_WORDS).join('|')})\\b`,
  'g'
)

// Capitalized words that are fine in the middle of a sentence.
// Any other mid-sentence capital is treated as a possible name.
const ALLOWED_CAPITALS = new Set([
  'I', "I'm", "I've", "I'll", "I'd", 'English',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
])

// Returns a list of safety problems with one story (empty list means it passed).
function checkSafety(story, v) {
  const problems = []
  if (typeof story !== 'string' || story.trim() === '') return ['empty story']
  // Treat curly apostrophes like straight ones, so "I’d" is not flagged as a name.
  const text = story.trim().replace(/[‘’]/g, "'")
  const words = text.split(/\s+/)

  if (words.length > MAX_WORDS) problems.push(`${words.length} words`)
  if (!/\b(I|I'm|I've|I'll|I'd|[Mm]y|[Mm]e|[Mm]yself)\b/.test(text)) problems.push('not first person')
  if (/[.!?]\s+\S/.test(text)) problems.push('more than one sentence')

  const banned = text.match(BANNED_RE)
  if (banned) problems.push(`banned word "${banned[0]}"`)

  // Numbers must be this villager's own numbers or the trial schedule numbers.
  const supplied = new Set([v.AGEP, v.JWMNP, v.WKHP, ...Object.values(SCHEDULE)])
  for (const digits of text.match(/\d+/g) ?? []) {
    if (!supplied.has(Number(digits))) problems.push(`unsupplied number ${digits}`)
  }
  // Compound number words like "twenty-five" count as ONE number (25), so check
  // them first and then blank them out before checking single number words.
  const lower = text.toLowerCase().replace(COMPOUND_NUMBER_RE, (match, tens, unit) => {
    const value = NUMBER_WORDS[tens] + UNIT_WORDS[unit]
    if (!supplied.has(value)) problems.push(`unsupplied number "${match}"`)
    return ' '
  })
  for (const w of lower.match(/[a-z]+/g) ?? []) {
    if (w in NUMBER_WORDS && !supplied.has(NUMBER_WORDS[w])) problems.push(`unsupplied number "${w}"`)
  }

  // Possible names: capitalized words after the first word.
  for (const raw of words.slice(1)) {
    const w = raw.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, '').replace(/'s$/, '')
    if (/^[A-Z]/.test(w) && !ALLOWED_CAPITALS.has(w)) problems.push(`possible name "${w}"`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// 6. Validation, part 2: VARIETY rules, checked against every story accepted
//    so far (across all batches). If all retries fail these, we keep the
//    attempt with the fewest variety problems.
// ---------------------------------------------------------------------------

const accepted = {} // id -> story
const openingCounts = new Map() // "my 20-minute" -> how many accepted stories start this way
const phrase4Counts = new Map() // 4-word phrase -> how many accepted stories contain it

function checkVariety(story, id) {
  const problems = []

  const opening = openingOf(story)
  if ((openingCounts.get(opening) ?? 0) >= OPENING_LIMIT) problems.push(`opening "${opening}" is overused`)

  for (const phrase of BANNED_PHRASES) {
    if (hasPhrase(story, phrase)) problems.push(`uses banned phrase "${phrase}"`)
  }

  for (const phrase of phrasesOf(story, 4)) {
    if ((phrase4Counts.get(phrase) ?? 0) >= PHRASE4_LIMIT) problems.push(`phrase "${phrase}" is overused`)
  }

  // Near-duplicate: shares too many 3-word phrases with an accepted story.
  const mine = phrasesOf(story, 3)
  for (const [otherId, other] of Object.entries(accepted)) {
    if (Number(otherId) === id) continue
    const theirs = phrasesOf(other, 3)
    let shared = 0
    for (const p of mine) if (theirs.has(p)) shared++
    const smaller = Math.min(mine.size, theirs.size)
    if (smaller > 0 && shared / smaller >= NEAR_DUPLICATE) {
      problems.push(`too similar to story ${otherId}`)
      break
    }
  }
  return problems
}

// Save a story and update the running counts.
function accept(id, story) {
  accepted[id] = story
  const opening = openingOf(story)
  openingCounts.set(opening, (openingCounts.get(opening) ?? 0) + 1)
  for (const phrase of phrasesOf(story, 4)) {
    phrase4Counts.set(phrase, (phrase4Counts.get(phrase) ?? 0) + 1)
  }
}

// Openings that have reached the limit, to warn the model up front.
function usedUpOpenings() {
  return [...openingCounts.entries()].filter(([, c]) => c >= OPENING_LIMIT).map(([k]) => k)
}

// Pull a JSON array out of the reply (tolerates code fences or stray prose).
function parseReply(text) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) throw new Error('no JSON array in reply')
  const data = JSON.parse(text.slice(start, end + 1))
  if (!Array.isArray(data)) throw new Error('reply is not an array')
  return data
}

// ---------------------------------------------------------------------------
// 7. Talking to Droid
// ---------------------------------------------------------------------------

// Droid runs in an empty temp folder with tools locked down, so it can only
// return text. It cannot see or change the repo.
const sandboxDir = mkdtempSync(join(tmpdir(), 'droid-stories-'))

// On Windows, `droid` on PATH is an npm .cmd shim the SDK cannot launch,
// so point the SDK at the real droid.exe inside the global npm package.
// Set DROID_PATH in .env to override.
function findDroidExe() {
  if (process.env.DROID_PATH) return process.env.DROID_PATH
  if (process.platform !== 'win32') return undefined // SDK finds `droid` on PATH
  const globalRoot = execSync('npm root -g', { encoding: 'utf-8' }).trim()
  const exe = join(globalRoot, 'droid', 'node_modules', '@factory', 'cli-win32-x64', 'bin', 'droid.exe')
  return existsSync(exe) ? exe : undefined
}

const RUN_OPTIONS = {
  execPath: findDroidExe(),
  cwd: sandboxDir,
  systemPrompt: SYSTEM_PROMPT,
  autonomyLevel: AutonomyLevel.Off,
  autoRejectPermissionRequests: true,
  disableBuiltinSkills: true,
}

// One fresh Droid session. Returns {id: story} for the ids that came back
// exactly once (anything else is treated as missing).
async function askDroid(batch, feedback) {
  let reply
  try {
    const result = await run(buildPrompt(batch, feedback, usedUpOpenings()), RUN_OPTIONS)
    if (!result.success) {
      console.log(`  run failed: ${result.error?.message ?? result.subtype}`)
      return {}
    }
    reply = parseReply(result.text)
  } catch (err) {
    console.log(`  error: ${err.message}`)
    return {}
  }

  const counts = new Map()
  for (const item of reply) counts.set(item?.id, (counts.get(item?.id) ?? 0) + 1)

  const storiesById = {}
  for (const v of batch) {
    if (counts.get(v.id) === 1) storiesById[v.id] = reply.find((item) => item.id === v.id).story
    else console.log(`  id ${v.id}: returned ${counts.get(v.id) ?? 0} times`)
  }
  return storiesById
}

// Write one batch: first try plus up to MAX_RETRIES retries of only the
// failing ids. Returns the ids that never produced a safe story.
async function generateBatch(batch) {
  const best = {} // id -> { story, problems } : safest attempt with fewest variety problems
  const feedback = {} // id -> why the last attempt failed (sent with the retry)
  let pending = batch

  for (let attempt = 0; attempt <= MAX_RETRIES && pending.length > 0; attempt++) {
    if (attempt > 0) console.log(`  retry ${attempt}: ${pending.length} villager(s)`)
    const storiesById = await askDroid(pending, feedback)

    const stillFailing = []
    for (const v of pending) {
      const raw = storiesById[v.id]
      if (raw === undefined) {
        feedback[v.id] = 'your story was missing from the reply'
        stillFailing.push(v)
        continue
      }
      const story = typeof raw === 'string' ? raw.trim() : raw

      const safety = checkSafety(story, v)
      if (safety.length > 0) {
        console.log(`  id ${v.id} unsafe: ${safety.join(', ')} -> ${JSON.stringify(story)}`)
        feedback[v.id] = safety.join('; ')
        stillFailing.push(v)
        continue
      }

      const variety = checkVariety(story, v.id)
      if (variety.length === 0) {
        accept(v.id, story)
        continue
      }
      console.log(`  id ${v.id} repetitive: ${variety.join(', ')} -> ${JSON.stringify(story)}`)
      feedback[v.id] = variety.join('; ')
      if (!best[v.id] || variety.length < best[v.id].problems.length) {
        best[v.id] = { story, problems: variety }
      }
      stillFailing.push(v)
    }
    pending = stillFailing
  }

  // Out of retries: keep the best SAFE attempt, or skip the villager.
  const skippedIds = []
  for (const v of pending) {
    if (best[v.id]) {
      console.log(`  id ${v.id}: keeping best attempt (${best[v.id].problems.join(', ')})`)
      accept(v.id, best[v.id].story)
    } else {
      skippedIds.push(v.id)
    }
  }
  return skippedIds
}

// ---------------------------------------------------------------------------
// 8. Main: shuffle, batches of 10, one fresh session per batch (and per retry).
// ---------------------------------------------------------------------------

const skipped = []
const order = shuffle(villagers)

try {
  for (let i = 0; i < order.length; i += BATCH_SIZE) {
    const batch = order.slice(i, i + BATCH_SIZE)
    console.log(`Batch ${i / BATCH_SIZE + 1}: ids ${batch.map((v) => v.id).join(', ')}`)
    skipped.push(...(await generateBatch(batch)))
  }
} finally {
  rmSync(sandboxDir, { recursive: true, force: true })
}

// Keep ids in numeric order in the file.
const sorted = {}
for (const v of villagers) if (accepted[v.id]) sorted[v.id] = accepted[v.id]

// Don't overwrite a good file with an empty one if every batch failed.
if (Object.keys(sorted).length === 0) {
  console.log('\nNo stories passed; public/data/stories.json was not written.')
  process.exit(1)
}

const output = {
  generatedBy: 'Factory Droid SDK',
  date: new Date().toISOString().slice(0, 10),
  note:
    'Illustrative fiction generated from census-derived fields. Not real people. ' +
    'Stories with focusKind "worry" use a generic trial worry assigned at random, not from the data, ' +
    'and only "burden" stories match what the sim scores.',
  stories: sorted,
  // id -> burden | money | trial demands | communication | worry
  focusKinds: Object.fromEntries(Object.keys(sorted).map((id) => [id, styleById[id].focusKind])),
}
writeFileSync(outputUrl, JSON.stringify(output, null, 2) + '\n')

console.log(`\nWrote ${Object.keys(sorted).length} of ${villagers.length} stories to public/data/stories.json`)
if (skipped.length > 0) console.log(`Skipped ids: ${skipped.join(', ')}`)

console.log('\n--- Repetition metrics for the new file ---')
printMetrics(measure(Object.values(sorted)))

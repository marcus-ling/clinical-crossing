// droidStories.mjs
// Build-time script: asks Factory Droid to write a one-sentence story for each
// villager, checks every story, and saves them to public/data/stories.json.
//
// Run from clinical-crossing/:
//   npm run stories
// (which runs: node --env-file=.env scripts/droidStories.mjs)
//
// The Droid SDK reads FACTORY_API_KEY from the environment by itself.
// This script never reads, logs, or writes the key.
//
// Stories are ILLUSTRATIVE FICTION built only from census-derived fields.
// The browser app never imports the SDK; it only reads the JSON this writes.

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, AutonomyLevel } from '@factory/droid-sdk/node'
import { runSim, BURDEN_LABELS } from '../src/sim/runSim.js'

const BATCH_SIZE = 25
const MAX_WORDS = 25

// Schedule numbers from protocol.json that any story may mention.
const SCHEDULE = { officeVisits: 7, phoneVisits: 6, weeks: 29 }

// Find the data files relative to this script, not the folder node was started in.
const villagersUrl = new URL('../public/data/villagers.json', import.meta.url)
const protocolUrl = new URL('../public/protocol.json', import.meta.url)
const outputUrl = new URL('../public/data/stories.json', import.meta.url)

const villagers = JSON.parse(readFileSync(villagersUrl, 'utf-8'))
const protocol = JSON.parse(readFileSync(protocolUrl, 'utf-8'))

// ---------------------------------------------------------------------------
// 1. Build the structured fields for each villager (nothing else is sent).
// ---------------------------------------------------------------------------

// Baseline run: all toggles off, same seed as the demo.
const baseline = runSim(
  villagers,
  protocol,
  { weekendVisits: false, homeBloodDraws: false, noFasting: false },
  42
)
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

function fieldsFor(v) {
  return {
    id: v.id,
    age: v.AGEP,
    commute_minutes: v.JWMNP,
    has_vehicle: v.VEH > 0,
    has_children_at_home: v.HUPAC !== 4, // same rule as runSim
    work_hours: v.WKHP,
    english_proficiency: ENGLISH_LABELS[v.ENG] ?? 'unknown',
    topBurdens: topBurdensById[v.id],
  }
}

// ---------------------------------------------------------------------------
// 2. The prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You write short, illustrative first-person lines for characters in a clinical trial simulation game.
You never use tools, never read or write files, and never run commands. You only reply with JSON.`

function buildPrompt(batch) {
  return `Here is a JSON list of fictional villagers. Each has only these fields:
- age (years)
- commute_minutes (roughly how long their one-way trip to the clinic takes)
- has_vehicle (true/false)
- has_children_at_home (true/false)
- work_hours (hours worked per week; 0 means they do not work)
- english_proficiency (how well they speak English)
- topBurdens (the biggest ways the trial schedule weighs on them, biggest first)

The trial schedule: ${SCHEDULE.officeVisits} office visits and ${SCHEDULE.phoneVisits} telephone visits over about ${SCHEDULE.weeks} weeks.

For EACH villager write one story with these rules:
- Exactly one sentence, at most ${MAX_WORDS} words, written in first person ("I", "my").
- About how the trial schedule affects them, focused on their topBurdens.
- Use only the supplied fields. Do not invent jobs, places, family details, or feelings beyond them.
- Do not include names, race, ethnicity, nationality, religion, diagnoses, diseases, medications, or medical advice.
- Do not use any number unless it is one of that villager's supplied numbers or a trial schedule number above.

Reply with ONLY a JSON array, no prose and no code fences, in this exact shape:
[{"id": 1, "story": "..."}, ...]
Include every id below exactly once.

Villagers:
${JSON.stringify(batch.map(fieldsFor), null, 2)}`
}

// ---------------------------------------------------------------------------
// 3. Validation
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

// Capitalized words that are fine in the middle of a sentence.
// Any other mid-sentence capital is treated as a possible name.
const ALLOWED_CAPITALS = new Set([
  'I', "I'm", "I've", "I'll", "I'd", 'English',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
])

// Returns a list of problems with one story (empty list means it passed).
function checkStory(story, v) {
  const problems = []
  if (typeof story !== 'string' || story.trim() === '') return ['empty story']
  const text = story.trim()
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
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (w in NUMBER_WORDS && !supplied.has(NUMBER_WORDS[w])) problems.push(`unsupplied number "${w}"`)
  }

  // Possible names: capitalized words after the first word.
  for (const raw of words.slice(1)) {
    const w = raw.replace(/^[^A-Za-z]+|[^A-Za-z']+$/g, '').replace(/'s$/, '')
    if (/^[A-Z]/.test(w) && !ALLOWED_CAPITALS.has(w)) problems.push(`possible name "${w}"`)
  }
  return problems
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
// 4. Ask Droid for one batch and keep the stories that pass.
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

// Returns { good: {id: story}, failedIds: [...] }
async function generateBatch(batch) {
  const byId = new Map(batch.map((v) => [v.id, v]))
  const allIds = batch.map((v) => v.id)

  let reply
  try {
    const result = await run(buildPrompt(batch), RUN_OPTIONS)
    if (!result.success) {
      console.log(`  run failed: ${result.error?.message ?? result.subtype}`)
      return { good: {}, failedIds: allIds }
    }
    reply = parseReply(result.text)
  } catch (err) {
    console.log(`  error: ${err.message}`)
    return { good: {}, failedIds: allIds }
  }

  // Count how many times each id came back.
  const counts = new Map()
  for (const item of reply) counts.set(item?.id, (counts.get(item?.id) ?? 0) + 1)

  const good = {}
  const failedIds = []
  for (const id of allIds) {
    if (counts.get(id) !== 1) {
      console.log(`  id ${id}: returned ${counts.get(id) ?? 0} times`)
      failedIds.push(id)
      continue
    }
    const story = reply.find((item) => item.id === id).story
    const problems = checkStory(story, byId.get(id))
    if (problems.length > 0) {
      console.log(`  id ${id}: ${problems.join(', ')} -> ${JSON.stringify(story)}`)
      failedIds.push(id)
    } else {
      good[id] = story.trim()
    }
  }
  const extra = [...counts.keys()].filter((id) => !byId.has(id))
  if (extra.length > 0) console.log(`  ignored unexpected ids: ${extra.join(', ')}`)

  return { good, failedIds }
}

// ---------------------------------------------------------------------------
// 5. Main: batches of 25, retry failures once, then skip them.
// ---------------------------------------------------------------------------

const stories = {}
const skipped = []

try {
  for (let i = 0; i < villagers.length; i += BATCH_SIZE) {
    const batch = villagers.slice(i, i + BATCH_SIZE)
    console.log(`Batch ${i / BATCH_SIZE + 1}: ids ${batch[0].id}-${batch[batch.length - 1].id}`)

    const first = await generateBatch(batch)
    Object.assign(stories, first.good)

    if (first.failedIds.length > 0) {
      console.log(`  retrying ${first.failedIds.length} villager(s) once`)
      const retryBatch = batch.filter((v) => first.failedIds.includes(v.id))
      const second = await generateBatch(retryBatch)
      Object.assign(stories, second.good)
      skipped.push(...second.failedIds)
    }
  }
} finally {
  rmSync(sandboxDir, { recursive: true, force: true })
}

// Keep ids in numeric order in the file.
const sorted = {}
for (const v of villagers) if (stories[v.id]) sorted[v.id] = stories[v.id]

// Don't overwrite a good file with an empty one if every batch failed.
if (Object.keys(sorted).length === 0) {
  console.log('\nNo stories passed; public/data/stories.json was not written.')
  process.exit(1)
}

const output = {
  generatedBy: 'Factory Droid SDK',
  date: new Date().toISOString().slice(0, 10),
  note: 'Illustrative fiction generated from census-derived fields. Not real people.',
  stories: sorted,
}
writeFileSync(outputUrl, JSON.stringify(output, null, 2) + '\n')

console.log(`\nWrote ${Object.keys(sorted).length} of ${villagers.length} stories to public/data/stories.json`)
if (skipped.length > 0) console.log(`Skipped ids: ${skipped.join(', ')}`)

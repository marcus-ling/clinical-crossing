// storyMetrics.mjs
// Measures how repetitive the generated stories are.
//
// Run from clinical-crossing/:
//   npm run stories:metrics                 (reads public/data/stories.json)
//   node scripts/storyMetrics.mjs other.json (reads another file)
//
// Prints:
//   (a) the share of stories that start with the same first two words
//   (b) the 10 most repeated 3-word and 4-word phrases, with counts
//   (c) the story count
//
// The small helpers below are also imported by droidStories.mjs so the
// validator counts phrases exactly the same way this report does.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Lowercase, drop punctuation (but keep apostrophes and hyphens inside words),
// and split into words. "My 20-minute trips." -> ["my", "20-minute", "trips"]
export function toWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\- ]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
    .filter(Boolean)
}

// The first two words, e.g. "my 20-minute".
export function openingOf(text) {
  return toWords(text).slice(0, 2).join(' ')
}

// Every n-word phrase in a story, each counted once per story.
export function phrasesOf(text, n) {
  const words = toWords(text)
  const set = new Set()
  for (let i = 0; i + n <= words.length; i++) set.add(words.slice(i, i + n).join(' '))
  return set
}

// Count how many stories each key appears in, then sort biggest first.
function topCounts(lists, limit) {
  const counts = new Map()
  for (const keys of lists) for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

// Returns all the numbers as an object (so other scripts can use them too).
export function measure(stories) {
  const n = stories.length
  return {
    count: n,
    openings: topCounts(stories.map((s) => [openingOf(s)]), 5),
    phrases3: topCounts(stories.map((s) => phrasesOf(s, 3)), 10),
    phrases4: topCounts(stories.map((s) => phrasesOf(s, 4)), 10),
  }
}

export function printMetrics(m) {
  const pct = (c) => `${((100 * c) / m.count).toFixed(0)}%`
  console.log(`(c) Story count: ${m.count}`)
  console.log('\n(a) Most common two-word openings (share of stories):')
  for (const [k, c] of m.openings) console.log(`  ${pct(c).padStart(4)}  ${c.toString().padStart(3)}  "${k}"`)
  console.log('\n(b) Top 3-word phrases (number of stories containing them):')
  for (const [k, c] of m.phrases3) console.log(`  ${c.toString().padStart(3)}  "${k}"`)
  console.log('\n    Top 4-word phrases:')
  for (const [k, c] of m.phrases4) console.log(`  ${c.toString().padStart(3)}  "${k}"`)
}

// Only run the report when this file is started directly (not when imported).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? new URL('../public/data/stories.json', import.meta.url)
  const data = JSON.parse(readFileSync(file, 'utf-8'))
  printMetrics(measure(Object.values(data.stories)))
}

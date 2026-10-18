# Project Brief: Clinical Crossing (context for Factory Droid)

This brief is background only. It does not assign a task. Specific tasks will be given separately. Do not change anything in the repo unless a task asks you to.

## What the project is
Trial Town is a cozy, Animal Crossing-style browser simulation of a clinical trial, built solo for a hackathon.

**Hackathon prompt:** "Build a solution that removes a major bottleneck on the path from discovery to an approved medicine."

**The idea:** Clinical trials often stall or produce unrepresentative results because of social barriers (travel time, work conflicts, caregiving, language), not biology. Trial Town models this. A small town of simulated villagers, sampled from real US census data, is asked to complete a real trial protocol. The player flips what-if rules (for example weekend visits, home blood draws, no fasting) and watches villagers stay or drop out, with a before/after retention number.

**Pitch line:** "Trials don't fail in the lab, they fail on the bus ride home."

## Who I am
Solo beginner hacker, limited time (roughly 12 build hours). Keep explanations in plain English and code simple and commented. I need to be able to explain everything to a judge.

## Current stack and structure
- React + Vite, browser only. No backend, no database.
- Python is used only for a data-prep script.
- Main folders: `public/data/` (villagers.csv, protocol.json), `scripts/` (data prep), `src/sim/` (the sim engine, a pure function with no UI code), `src/components/` (game board and UI).
- `CLAUDE.md` in the repo root contains the full project rules and is the source of truth if anything here conflicts with it.

## Important context about this repo
- **Another AI tool (Claude Code) is the main code writer.** Avoid broad refactors, reformatting, or renaming files, since that can break its work. Prefer small, targeted, reviewable changes.
- Do not add dependencies without asking first.
- The sim logic and its assumptions are the core of the project. Do not alter coefficients or sim behavior unless explicitly asked.

## Honesty rules (apply to everything)
- Villagers are sampled from real data, but the behavior rules and coefficients are **illustrative assumptions** unless a published source is cited. Never invent statistics, dropout rates, or trial facts. If unsure, leave a `TODO: verify` comment.
- Sim output is not a real-world prediction. Label it as illustrative.
- Do not use race or ethnicity as a biological proxy. Use structural variables only (transit, income, caregiving, language).
- Any generated villager story is fiction and must be labeled as such.
- Do not make claims about FDA policy or regulations without a cited source.

## Out of scope for this project
User accounts, saved games, multiplayer, live protocol upload, multiple regions, and anything requiring a server.

## Status
See the checklist at the bottom of `CLAUDE.md`. Update it rather than duplicating status here.

## How to work with me
- Explain what you did and why, in plain English.
- If a task is ambiguous, state your assumption briefly and proceed, or ask one short question.
- Tell me when something you built has limits or could break, rather than only reporting success.
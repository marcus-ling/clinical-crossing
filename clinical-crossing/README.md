# Clinical Crossing

A cozy town-builder take on a real clinical trial. You get three policy changes, typed in your own words, and you see how many villagers stick with the trial. An AI reads your ideas and maps each one to a lever. A small, deterministic simulation does all the math.

Everything is **illustrative**: the villagers come from real census data, but the behavior rules and policy effect sizes are assumptions, not real-world predictions.

## Run it locally

You need Node.js 20 or newer (tested on 24).

```bash
cd clinical-crossing
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

### With the Gemini interpreter (optional)

Without a key the game still works: it uses a simple offline keyword matcher and shows an "Offline matcher in use" banner.

To use Gemini:

1. Get an API key from Google AI Studio.
2. Add this line to `clinical-crossing/.env` (the file is git-ignored; never commit it):
   ```
   GEMINI_API_KEY=your-key-here
   ```
   Don't prefix it with `VITE_`: that would send it to the browser.
3. Restart `npm run dev`. The dev server also runs the serverless function `api/interpret.js` at `/api/interpret`, so you don't need the Vercel CLI.

Players' text is sent to Google's Gemini API. Nothing is stored.

## Checks

Plain node, no test framework:

```bash
node scripts/checkSim.js      # the sim: baseline near 87%, levers help, determinism
node scripts/checkLevers.js   # levers, dedupe, validator, par
```

## Deploy (Vercel)

- Set the project's Root Directory to `clinical-crossing`.
- Add `GEMINI_API_KEY` under Settings → Environment Variables.
- Vercel builds the site with `npm run build` and deploys `api/interpret.js` as the one serverless function.

## How it fits together

- `src/sim/runSim.js`: the simulation, a pure function. All coefficients are in `ASSUMPTIONS`.
- `src/sim/levers.js`: the closed list of policy levers. Each one eases one burden.
- `src/sim/scoring.js`: dedupe, each policy's marginal effect, subgroups, par and score.
- `api/interpret.js`: asks Gemini to pick a lever + strength for each policy (structured output). The AI never sets numbers.
- `src/ai/`: request/reply validation, the browser client and the offline fallback.

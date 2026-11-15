import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Dev only: run the serverless function in api/interpret.js inside the Vite
// dev server, so `npm run dev` works without the Vercel CLI. On Vercel the
// same file is deployed as a real function and this plugin is not used.
function localApi() {
  return {
    name: 'local-api',
    apply: 'serve', // never part of the production build
    configureServer(server) {
      server.middlewares.use('/api/interpret', async (req, res) => {
        try {
          // Load the function fresh each time, so edits show up without a restart.
          const fn = await server.ssrLoadModule('/api/interpret.js')
          const handler = req.method === 'POST' ? fn.POST : fn.GET

          // Turn Node's request into a Web Request (what the function expects).
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const request = new Request(`http://localhost${req.originalUrl}`, {
            method: req.method,
            headers: req.headers,
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
          })

          // And the Web Response back into Node's response.
          const response = await handler(request)
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Local API error.' }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Give the local function GEMINI_API_KEY from .env. Only this one variable,
  // and only on the server side: the browser never sees it (Vite only sends
  // variables starting with VITE_ to the browser).
  const env = loadEnv(mode, process.cwd(), '')
  if (env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = env.GEMINI_API_KEY
  }

  return {
    plugins: [react(), localApi()],
  }
})

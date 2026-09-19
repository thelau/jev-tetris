// Static files plus one proxy route, so the key never reaches the browser.
import { createServer } from 'node:http'
import { readFile, mkdir, appendFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

try { process.loadEnvFile('.env') } catch {}

const PORT = Number(process.env.PORT || 5173)
const ROOT = process.cwd()
const HOST = process.env.HOST || '127.0.0.1'   // loopback only; this process holds a key
const SERVE = [resolve(ROOT, 'public'), resolve(ROOT, 'src')]
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

// Provenance. Every call to the model is written down raw, so the run can be
// audited afterwards and nobody has to take our word for what decided the game.
// Input is metered, output is not. Launch pricing, and the vendor says it is
// below cost — treat the money as provisional.
const USD_PER_INPUT_TOKEN = 0.042 / 1e6
// Hard ceiling. The browser cannot be trusted not to loop, and a tab left open
// overnight is the expensive failure mode. Enforced here because the key is here.
const MAX_CALLS = Number(process.env.JEV_MAX_CALLS || 1500)
const MAX_USD = Number(process.env.JEV_MAX_USD || 1)
const RUN = new Date().toISOString().replace(/[:.]/g, '-')
const LOG = join(process.cwd(), 'runs', `${RUN}.jsonl`)
const total = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, model: null }

async function record(entry) {
  try {
    await mkdir(join(process.cwd(), 'runs'), { recursive: true })
    await appendFile(LOG, JSON.stringify(entry) + '\n')
  } catch (e) { console.error('log failed:', e.message) }
}

// Mock mode: answer in the real response shape without calling the API, so
// the test suite and anyone forking this can run it with no key and no cost.
const MOCK = process.env.JEV_MOCK === '1' || process.argv.includes('--mock')
let mockFails = false

function mockAnswer(body) {
  const out = { model: 'jev-mock-1.13.0', answers: {}, usage: { input_tokens: 8800, output_tokens: 850 } }
  for (const [name, q] of Object.entries(body.questions ?? {})) {
    if (q.type === 'choice') {
      const keys = Object.keys(q.criteria ?? {})
      const weights = keys.map(() => Math.random() ** 3)
      const sum = weights.reduce((a, b) => a + b, 0) || 1
      const probabilities = {}
      keys.forEach((k, i) => { probabilities[k] = Math.round((weights[i] / sum) * 100) / 100 })
      const choice = keys.reduce((a, b) => (probabilities[b] > probabilities[a] ? b : a), keys[0])
      out.answers[name] = { type: 'choice', choice, confidence: 0.4, probabilities }
    } else if (q.type === 'score') {
      out.answers[name] = { type: 'score', score: Math.random() * 3, confidence: 0.6, legend: {}, probabilities: {} }
    } else {
      out.answers[name] = { type: 'noul', noul: Math.random() }
    }
  }
  return out
}

const server = createServer(async (req, res) => {
  // test hook: make the next calls fail, to prove a dead connection is not a lost game
  if (MOCK && req.method === 'POST' && req.url === '/api/fail') {
    mockFails = !mockFails
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ failing: mockFails }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/move') {
    if (total.calls >= MAX_CALLS || total.usd >= MAX_USD) {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: `budget reached: ${total.calls} calls, $${total.usd.toFixed(3)} (limits ${MAX_CALLS} / $${MAX_USD})`,
        budget: true,
      }))
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    if (MOCK) {
      if (mockFails) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"mock failure"}'); return }
      const payload = mockAnswer(JSON.parse(body))
      total.calls++
      total.inputTokens += payload.usage.input_tokens
      total.outputTokens += payload.usage.output_tokens
      total.usd = total.inputTokens * USD_PER_INPUT_TOKEN
      total.model = payload.model
      payload._meta = { ms: 1, cumulative: { ...total } }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
      return
    }

    try {
      const endpoint = process.env.JEV_ENDPOINT || 'https://api.typesafe.ai/v1/systemone'
      const sent = JSON.stringify({ ...JSON.parse(body), model: process.env.JEV_MODEL || 'jev-latest' })
      const t0 = performance.now()
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
        },
        body: sent,
      })
      const text = await upstream.text()
      const ms = Math.round(performance.now() - t0)
      if (!upstream.ok) console.error(`upstream ${upstream.status} from ${endpoint}: ${text.slice(0, 200)}`)

      let payload
      try { payload = JSON.parse(text) } catch { payload = null }

      if (payload?.usage) {
        total.calls++
        total.inputTokens += payload.usage.input_tokens ?? 0
        total.outputTokens += payload.usage.output_tokens ?? 0
        total.usd = total.inputTokens * USD_PER_INPUT_TOKEN
        total.model = payload.model ?? total.model
      }

      await record({
        t: new Date().toISOString(),
        ms,
        status: upstream.status,
        request: JSON.parse(sent),
        response: payload ?? text,
        cumulative: { ...total },
      })

      if (payload) {
        payload._meta = { ms, cumulative: { ...total } }
        res.writeHead(upstream.status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      } else {
        res.writeHead(upstream.status, { 'content-type': 'application/json' })
        res.end(text)
      }
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  // Resolve FIRST, then check the resolved path is inside a served directory.
  // Testing the raw url before normalising let `/src/../.env` escape the root
  // and serve the API key over the network.
  let bare
  try { bare = decodeURIComponent(req.url.split('?')[0]) } catch { bare = req.url.split('?')[0] }
  if (req.url.split('?')[0] === '/api/version') {
    const files = ['public/main.js', 'public/style.css', 'public/index.html', 'src/describe.js', 'src/tetris.js']
    let stamp = 0
    for (const f of files) {
      try { stamp = Math.max(stamp, (await stat(join(ROOT, f))).mtimeMs) } catch {}
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      build: Math.round(stamp),
      ready: MOCK || Boolean(process.env.TYPESAFE_API_KEY),
      mock: MOCK,
    }))
    return
  }

  const url = bare === '/' ? '/public/index.html' : bare
  const candidate = url.startsWith('/src/') || url.startsWith('/public/')
    ? resolve(ROOT, '.' + url)
    : resolve(ROOT, 'public', '.' + url)
  if (!SERVE.some((dir) => candidate === dir || candidate.startsWith(dir + sep))) {
    res.writeHead(404).end('not found')
    return
  }
  try {
    const data = await readFile(candidate)
    res.writeHead(200, { 'content-type': TYPES[extname(candidate)] || 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404).end('not found')
  }
})

server.listen(PORT, HOST, () => {
  if (MOCK) console.log('MOCK MODE — no API calls, no cost')
  else if (!process.env.TYPESAFE_API_KEY) console.warn('warning: no TYPESAFE_API_KEY in .env')
  console.log(`jev-tetris   →  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)
  console.log(`run log      →  runs/${RUN}.jsonl`)
  console.log(`budget       →  ${MAX_CALLS} calls or $${MAX_USD}, whichever comes first`)
})

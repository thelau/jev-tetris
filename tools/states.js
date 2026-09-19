// Capture every state of the interface into docs/stills/states/.
// Real server for the normal states, throwaway mock servers for the failures.
//
//   node tools/states.js

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { open, sleep } from './cdp.js'

const OUT = 'docs/stills/states'
const DESKTOP = [1440, 900]
const PHONE = [390, 844]
const shots = []

await mkdir(OUT, { recursive: true })

async function grab(page, name, note) {
  const r = await page.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'))
  shots.push({ name, note })
  console.log(`  ${name}.png — ${note}`)
}

async function waitFor(page, fn, ms = 60000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn(await page.json('window.__test.state()'))) return true
    await sleep(150)
  }
  return false
}

function serve(port, env) {
  return spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), ...env }, stdio: 'ignore' })
}

// ── real server: the states a visitor actually sees ──────────────────────────
const real = serve(5301, {})
await sleep(1500)
const base = 'http://localhost:5301'

for (const [label, [w, h]] of [['desktop', DESKTOP], ['phone', PHONE]]) {
  let page = await open({ url: base, width: w, height: h, keepRendering: true, port: 9400 })
  await sleep(1200)
  await grab(page, `1-attract-${label}`, 'before anything is pressed')
  page.close()
  await sleep(400)

  page = await open({ url: `${base}?hold=2000&auto=1`, width: w, height: h, keepRendering: true, port: 9400 })
  await waitFor(page, (s) => s.pieces >= 6)

  await waitFor(page, (s) => s.phase === 'thinking')
  await sleep(200)
  await grab(page, `2-waiting-${label}`, 'a call is in flight; the rule sweeps and MS counts up')

  await waitFor(page, (s) => s.phase === 'field')
  await sleep(500)
  await grab(page, `3-decided-${label}`, 'the answer is back; the probability field is on the board')

  if (label === 'desktop') {
    await page.evaluate('window.__ui.why(true)')
    await sleep(400)
    await grab(page, '4-panel-decision', 'every option, the model probabilities, and the cost')
    await page.evaluate('window.__ui.why(false); window.__ui.help(true)')
    await sleep(400)
    await grab(page, '5-panel-legend', 'what everything on screen means')
    await page.evaluate('window.__ui.help(false)')
  }

  await page.evaluate('window.__test.die()')
  await sleep(600)
  await grab(page, `6-lost-${label}`, 'the end screen, over the grey wall it built')
  page.close()
  await sleep(400)
}
real.kill()
await sleep(400)

// ── failure states, on throwaway servers ─────────────────────────────────────
const nokey = serve(5302, { TYPESAFE_API_KEY: '' })
await sleep(1500)
let page = await open({ url: 'http://localhost:5302', width: DESKTOP[0], height: DESKTOP[1], keepRendering: true, port: 9401 })
await sleep(1500)
await grab(page, '7-no-key', 'server has no API key; no START is offered')
page.close()
nokey.kill()
await sleep(400)

const broken = serve(5303, { GLOW_MOCK: '1' })
await sleep(1500)
page = await open({ url: 'http://localhost:5303?hold=120&auto=1', width: DESKTOP[0], height: DESKTOP[1], keepRendering: true, port: 9402 })
await waitFor(page, (s) => s.pieces >= 3)
await fetch('http://localhost:5303/api/fail', { method: 'POST' })
await waitFor(page, (s) => s.phase === 'stalled')
await sleep(400)
await grab(page, '8-no-answer', 'the model did not reply; this is not a lost game')
page.close()
broken.kill()
await sleep(400)

const capped = serve(5304, { GLOW_MOCK: '1', GLOW_MAX_CALLS: '4' })
await sleep(1500)
page = await open({ url: 'http://localhost:5304?hold=120&auto=1', width: DESKTOP[0], height: DESKTOP[1], keepRendering: true, port: 9403 })
await waitFor(page, (s) => s.phase === 'stalled')
await sleep(400)
await grab(page, '9-budget-reached', 'the spend limit stopped it')
page.close()
capped.kill()

console.log(`\n${shots.length} states written to ${OUT}/`)
process.exit(0)

// Capture every state of the interface, at both ends of the size range, and
// confirm the strip does not move between them.
//
//   node tools/states.js

import { spawn } from 'node:child_process'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { open, sleep } from './cdp.js'

const OUT = 'docs/stills/states'
const SIZES = [['desktop', 1440, 900], ['phone', 360, 640]]
const geo = {}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const serve = (port, env) =>
  spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), ...env }, stdio: 'ignore' })

async function grab(page, name, label) {
  await booted(page)
  const r = await page.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(`${OUT}/${name}-${label}.png`, Buffer.from(r.result.data, 'base64'))
  const s = await page.json('window.__test.state()')
  ;(geo[label] ||= []).push({ name, stripTop: s.stripTop, strip: s.strip, header: s.header, cell: s.cell })
  console.log(`  ${name}-${label}.png`)
}

// the module fetches three imports and two fonts before __test exists
const booted = async (page, ms = 20000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if ((await page.evaluate('typeof window.__test')) === 'object') return true
    await sleep(140)
  }
  throw new Error('app never booted')
}
const until = async (page, fn, ms = 40000) => {
  await booted(page)
  const end = Date.now() + ms
  while (Date.now() < end) { if (fn(await page.json('window.__test.state()'))) return true; await sleep(140) }
  return false
}

for (const [label, w, h] of SIZES) {
  const live = serve(5311, { JEV_MOCK: '1', JEV_MOCK_DELAY: '1400' })
  await sleep(1400)

  let page = await open({ url: 'http://localhost:5311', width: w, height: h, keepRendering: true })
  await booted(page)
  await sleep(700)
  await grab(page, '1-attract', label)
  page.close(); await sleep(300)

  page = await open({ url: 'http://localhost:5311?hold=2500&auto=1', width: w, height: h, keepRendering: true })
  await until(page, (s) => s.pieces >= 4)

  await until(page, (s) => s.phase === 'thinking')
  await sleep(120)
  await grab(page, '2-waiting', label)

  await until(page, (s) => s.phase === 'field')
  await sleep(500)
  await grab(page, '3-decided', label)

  await page.evaluate('window.__test.forceNearMiss()')
  await sleep(150)
  await grab(page, '4-near-miss', label)

  await page.evaluate('window.__ui.help(true)')
  await sleep(400)
  await grab(page, '5-panel', label)
  await page.evaluate('window.__ui.help(false)')

  await page.evaluate('window.__test.die()')
  await sleep(700)
  await grab(page, '6-lost', label)
  page.close(); live.kill(); await sleep(400)

  const broken = serve(5312, { JEV_MOCK: '1' })
  await sleep(1400)
  page = await open({ url: 'http://localhost:5312?hold=120&auto=1', width: w, height: h, keepRendering: true })
  await until(page, (s) => s.pieces >= 2)
  await fetch('http://localhost:5312/api/fail', { method: 'POST' })
  await until(page, (s) => s.phase === 'stalled')
  await sleep(300)
  await grab(page, '7-no-answer', label)
  page.close(); broken.kill(); await sleep(300)

  const capped = serve(5313, { JEV_MOCK: '1', JEV_MAX_CALLS: '3' })
  await sleep(1400)
  page = await open({ url: 'http://localhost:5313?hold=120&auto=1', width: w, height: h, keepRendering: true })
  await until(page, (s) => s.phase === 'stalled')
  await sleep(300)
  await grab(page, '8-no-budget', label)
  page.close(); capped.kill(); await sleep(300)

  const nokey = serve(5314, { TYPESAFE_API_KEY: '' })
  await sleep(1400)
  page = await open({ url: 'http://localhost:5314', width: w, height: h, keepRendering: true })
  await sleep(1600)
  await grab(page, '9-no-key', label)
  page.close(); nokey.kill(); await sleep(300)
}

console.log('\nstrip identical across states?')
let ok = true
for (const [label, rows] of Object.entries(geo)) {
  const a = rows[0]
  const drift = rows.filter((r) => r.stripTop !== a.stripTop || r.strip !== a.strip || r.header !== a.header)
  console.log(`  ${label.padEnd(8)} cell ${a.cell}  header ${a.header}  strip ${a.strip} at y=${a.stripTop}  ` +
    (drift.length ? `MOVED in: ${drift.map((d) => d.name).join(', ')}` : `identical in all ${rows.length}`))
  if (drift.length) ok = false
}
process.exit(ok ? 0 : 1)

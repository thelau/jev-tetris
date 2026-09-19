// Headless screenshots over the DevTools protocol. No dependencies —
// Chrome is already on the machine and Node has a WebSocket now.
//
//   node tools/shot.js --url http://localhost:5173 --out /tmp/a.png --wait 20000

import { spawn } from 'node:child_process'
import { writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i === -1 ? d : process.argv[i + 1]
}

const url = arg('url', 'http://localhost:5173')
const out = arg('out', '/tmp/shot.png')
const waitMs = Number(arg('wait', 8000))
const width = Number(arg('w', 900))
const height = Number(arg('h', 1000))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const profile = await mkdtemp(join(tmpdir(), 'glowshot-'))
const chrome = spawn(CHROME, [
  '--headless=new',
  '--hide-scrollbars',
  '--disable-gpu',
  '--force-device-scale-factor=2',
  `--window-size=${width},${height}`,
  `--user-data-dir=${profile}`,
  '--remote-debugging-port=9333',
  url,
], { stdio: 'ignore' })

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {}
    await sleep(250)
  }
  throw new Error('chrome never came up')
}

const page = await target()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
const send = (method, params = {}) => new Promise((resolve) => {
  const mid = ++id
  pending.set(mid, resolve)
  ws.send(JSON.stringify({ id: mid, method, params }))
})

await send('Page.enable')
await send('Runtime.enable')
// --window-size is unreliable in headless; set the viewport explicitly.
const emu = await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 2, mobile: width < 500,
  screenWidth: width, screenHeight: height, positionX: 0, positionY: 0,
})
if (emu.error) console.log('emulation error:', JSON.stringify(emu.error))
await send('Page.navigate', { url })
await sleep(500)

// surface page errors rather than screenshotting a blank canvas
const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.description || a.value).join(' '))
})

const until = arg('until', null)     // wait for this phase before shooting
const after = Number(arg('after', 0)) // ...but only once this many pieces are down

console.log(`waiting ${waitMs}ms for the machine to play…`)
if (until) {
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    const r = await send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__glow ? window.__glow() : {})',
      returnByValue: true,
    })
    const st = JSON.parse(r.result?.result?.value || '{}')
    const maxConf = arg('maxconf', null)
    const confOk = maxConf === null || (st.lastConf ?? 1) <= Number(maxConf)
    if (st.phase === until && (st.pieces ?? 0) >= after && confOk) { await sleep(Number(arg('delay', 0))); break }
    await sleep(40)
  }
} else {
  await sleep(waitMs)
}

const evalJs = arg('eval', null)
if (evalJs) { await send('Runtime.evaluate', { expression: evalJs }); await sleep(250) }

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
if (!shot.result?.data) throw new Error(`no screenshot: ${JSON.stringify(shot).slice(0, 300)}`)
await writeFile(out, Buffer.from(shot.result.data, 'base64'))

const fit = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    view: [innerWidth, innerHeight],
    doc: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    canvas: (() => { const c = document.getElementById('stage'); const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.top), Math.round(r.bottom)] })(),
    scrolls: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
  })`,
  returnByValue: true,
})
const f = JSON.parse(fit.result?.result?.value || '{}')
console.log(`viewport ${f.view?.join('x')}  doc ${f.doc?.join('x')}  canvas ${f.canvas?.slice(0,2).join('x')} (top ${f.canvas?.[2]}, bottom ${f.canvas?.[3]})  ${f.scrolls ? 'SCROLLS ✗' : 'fits ✓'}`)

const state = await send('Runtime.evaluate', {
  expression: 'JSON.stringify(window.__glow ? window.__glow() : {missing:true})',
  returnByValue: true,
})
console.log('page state:', state.result?.result?.value ?? '(unavailable)')
if (errors.length) console.log('page errors:\n  ' + [...new Set(errors)].join('\n  '))
console.log(`wrote ${out}`)

ws.close()
chrome.kill()
process.exit(0)

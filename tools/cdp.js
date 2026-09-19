// Just enough DevTools protocol to drive headless Chrome. No dependencies:
// Chrome is already on the machine and Node has a WebSocket.

import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A fixed debugging port makes two concurrent runs attach to each other's
// browser, which fails in ways that look like application bugs.
let nextPort = 9400 + Math.floor(Math.random() * 400)

export async function open({ url, width = 1440, height = 900, port = nextPort++, keepRendering = false }) {
  const profile = await mkdtemp(join(tmpdir(), 'jev-'))
  const chrome = spawn(CHROME, [
    '--headless=new', '--hide-scrollbars', '--disable-gpu',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank',
  ], { stdio: 'ignore' })

  let target = null
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch {}
    if (!target) await sleep(250)
  }
  if (!target) { chrome.kill(); throw new Error('chrome never came up') }

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let id = 0
  const pending = new Map()
  const errors = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    // Headless throttles requestAnimationFrame unless something is consuming
    // frames, which stalls any canvas render loop. A screencast keeps it alive.
    if (m.method === 'Page.screencastFrame') {
      ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }))
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text)
    }
  })
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await setViewport(send, width, height)
  await send('Page.navigate', { url })
  if (keepRendering) await send('Page.startScreencast', { format: 'jpeg', quality: 5, maxWidth: 160, maxHeight: 160 })
  await sleep(600)

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text)
    return r.result?.result?.value
  }

  const json = async (expression) => JSON.parse(await evaluate(`JSON.stringify(${expression})`))

  // forces a paint, so a canvas that only draws in rAF is up to date
  const frame = async () => { await send('Page.captureScreenshot', { format: 'jpeg', quality: 1 }); await sleep(80) }

  return {
    send, evaluate, json, errors, frame,
    resize: (w, h) => setViewport(send, w, h),
    close: () => { try { ws.close() } catch {} chrome.kill() },
  }
}

// --window-size is unreliable in headless; screenWidth/Height are required too.
async function setViewport(send, width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 2, mobile: width < 500,
    screenWidth: width, screenHeight: height, positionX: 0, positionY: 0,
  })
  await sleep(250)
}

// End-to-end test. Runs the real page against a mocked model, so it needs no
// API key and costs nothing.
//
//   node tools/e2e.js

import { spawn } from 'node:child_process'
import { open, sleep } from './cdp.js'

const PORT = 5199
const URL = `http://localhost:${PORT}?hold=120&auto=1`

let passed = 0
let failed = 0
const hasButton = async (action) => {
  await page.frame()
  return page.json(`window.__hit().some(b => b.action === ${JSON.stringify(action)})`)
}
const clickButton = async (action) => {
  await page.frame()
  const r = await page.evaluate(`window.__click(${JSON.stringify(action)})`)
  await sleep(150)
  return r
}
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`)
  ok ? passed++ : failed++
}

async function until(fn, ms = 15000, every = 150) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await fn()) return true
    await sleep(every)
  }
  return false
}

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, GLOW_MOCK: '1', PORT: String(PORT) },
  stdio: 'ignore',
})
await sleep(1200)

let page
try {
  page = await open({ url: URL, width: 1440, height: 900, keepRendering: true })

  console.log('\nloading')
  check('page boots and exposes its state', !!(await page.json('window.__test.state()')))

  console.log('\nplaying')
  const moved = await until(async () => (await page.json('window.__test.state()')).pieces >= 2)
  check('the loop completes moves', moved, `${(await page.json('window.__test.state()')).pieces} pieces`)

  await page.evaluate('window.__ui.why(true)')
  check('a decision is recorded for inspection', await until(() => hasButton('close'), 10000))
  await page.evaluate('window.__ui.why(false)')

  console.log('\nlayout — nothing may scroll, at any size')
  for (const [w, h] of [[1440, 900], [1280, 800], [820, 1180], [390, 844], [360, 640]]) {
    await page.resize(w, h)
    await sleep(200)
    const f = await page.json(`({
      scrolls: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      box: (() => { const r = document.getElementById('stage').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })(),
    })`)
    check(`${w}×${h} fits`, !f.scrolls, `canvas ${f.box.join('×')}`)
  }
  await page.resize(1440, 900)

  console.log('\noverlays')
  await clickButton('help')
  check('? opens the legend', await hasButton('close'))
  await clickButton('close')
  check('× closes it', !(await hasButton('close')))
  await clickButton('why')
  check('WHY opens the decision', await hasButton('close'))
  await clickButton('close')

  console.log('\na broken connection is not a lost game')
  const before = (await page.json('window.__test.state()')).history
  await fetch(`http://localhost:${PORT}/api/fail`, { method: 'POST' })
  const stalled = await until(async () => (await page.json('window.__test.state()')).phase === 'stalled', 25000)
  const s1 = await page.json('window.__test.state()')
  check('it stalls rather than dying', stalled && !s1.dead, `phase=${s1.phase} dead=${s1.dead}`)
  check('no junk round is recorded', s1.history === before, `history ${before} → ${s1.history}`)
  check('TRY AGAIN is offered', await hasButton('retry'))

  await fetch(`http://localhost:${PORT}/api/fail`, { method: 'POST' })
  await clickButton('retry')
  const recovered = await until(async () => (await page.json('window.__test.state()')).phase !== 'stalled', 15000)
  check('it recovers when the server returns', recovered)

  console.log('\nlosing and restarting')
  const piecesBefore = (await page.json('window.__test.state()')).pieces
  await page.evaluate('window.__test.die()')
  await sleep(300)
  const dead = await page.json('window.__test.state()')
  check('losing sets the end state', dead.dead === true && dead.phase === 'over')
  check('the round is recorded', dead.history === before + 1, `history ${dead.history}`)
  check('START is offered', await hasButton('start'))
  check('the legend stays reachable after losing', await hasButton('help'))

  await clickButton('start')
  const restarted = await until(async () => {
    const s = await page.json('window.__test.state()')
    return s.dead === false && s.pieces < piecesBefore
  }, 15000)
  const after = await page.json('window.__test.state()')
  check('START begins a new game', restarted, `dead=${after.dead} pieces=${after.pieces}`)
  check('it keeps playing after restart',
    await until(async () => (await page.json('window.__test.state()')).pieces >= 1, 15000))

  console.log('\nreadiness')
  const v = await (await fetch(`http://localhost:${PORT}/api/version`)).json()
  check('mock server reports ready', v.ready === true && v.mock === true)
  const noKey = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, TYPESAFE_API_KEY: '', PORT: '5198' }, stdio: 'ignore',
  })
  await sleep(1200)
  try {
    const nv = await (await fetch('http://localhost:5198/api/version')).json()
    check('a keyless server reports not ready', nv.ready === false)
  } catch (e) {
    check('a keyless server reports not ready', false, e.message)
  } finally { noKey.kill() }

  console.log('\nconsole')
  check('no uncaught exceptions', page.errors.length === 0, page.errors.slice(0, 2).join(' | '))
} catch (e) {
  check('suite ran without throwing', false, e.message)
} finally {
  page?.close()
  server.kill()
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)

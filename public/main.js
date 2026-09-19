import { COLS, ROWS, PIECES, emptyBoard, enumeratePlacements, applyPlacement, makeBag, LINE_SCORE } from '/src/tetris.js'
import { describeBoard, describePlacements, buildQuestions, blend, VOICES } from '/src/describe.js'

const params = new URLSearchParams(location.search)
const HOLD = Number(params.get('hold') ?? 380)   // how long the field stays up
// Options it effectively rejected should look rejected. At gamma 0.45 a 1%
// option rendered at 13% brightness, which read as a serious suggestion.
const FIELD_GAMMA = Number(params.get('gamma') ?? 0.8)
const FIELD_FLOOR = Number(params.get('floor') ?? 0.02)
// Two honest readings of the same answer:
//   sum — the marginal probability this cell ends up occupied (many weak
//         candidates overlapping can light a cell no single option wants)
//   max — the strongest single placement covering this cell
const FIELD_MODE = params.get('field') === 'max' ? 'max' : 'sum'
const SEED = Number(params.get('seed') ?? Math.floor(Math.random() * 1e6))
const AUTO = params.get('auto') === '1'   // loop without waiting to be restarted

// Muted, slightly dulled. The stack is the only saturated thing on screen,
// and even it is dimmed by how sure the machine was when it placed each block.
const C = {
  ground: '#232323',
  bezel: '#2f2f2f',
  bezelEdge: '#3c3c3c',
  well: '#292929',
  grid: '#333333',
  dim: '#5f5f5f',
  bright: '#9d9d9d',
}
const PIECE_COLOR = {
  I: '#d4d4d4', O: '#dd962e', T: '#7a5ea3',
  S: '#55a058', Z: '#bb4a44', J: '#3f6fae', L: '#cf7429',
}

const BEZEL = 14
let READOUT = 62
let HEADER = 40      // the score sits above the well, arcade fashion
let TOP = 14         // top of the playfield, below the header

const canvas = document.getElementById('stage')
const ctx = canvas.getContext('2d')
let CELL = 30
let cssScale = 1
let logicalW = 0
let logicalH = 0

const STRIP = {
  wide: {
    base: 530, h: 96, pad: 16, bars: 9,
    label: 10, hero: 22, meter: 11, blocks: 12, footer: 10,
    labelY: 14, heroY: 28, arrowY: 38, arrowFrom: 150, arrowTo: 364, arrowHead: 372,
    meterY: 60, blocksY: 59, blocksX: 58, pctX: 214, showPct: true,
    combRight: 456, combTop: 56, combBase: 70,
    ruleY: 74, footerY: 82, qY: 81,
  },
  narrow: {
    base: 290, h: 88, pad: 10, bars: 5,
    label: 9, hero: 16, meter: 10, blocks: 11, footer: 9,
    labelY: 11, heroY: 24, arrowY: 32, arrowFrom: 104, arrowTo: 184, arrowHead: 191,
    meterY: 52, blocksY: 51, blocksX: 46, pctX: 0, showPct: false,
    combRight: 234, combTop: 49, combBase: 61,
    ruleY: 68, footerY: 75, qY: 74,
  },
}
const stripSpec = (wellW) => (wellW < 420 ? STRIP.narrow : STRIP.wide)
function stripHeight(wellW) {
  const sp = stripSpec(wellW)
  return Math.round(sp.h * (wellW / sp.base))
}

function layout() {
  // READOUT depends on CELL and CELL depends on READOUT, so solve it rather
  // than guess: two passes converge, and the result must never exceed the
  // viewport in either direction — no scrolling, desktop or phone.
  const vv = window.visualViewport
  const availH = (vv?.height ?? window.innerHeight) - 24
  const availW = (vv?.width ?? window.innerWidth) - 24

  const readoutFor = (c) => stripHeight(COLS * c)
  const headerFor = (c) => Math.round(Math.max(30, c * 1.2))
  let c = Math.min((availW - BEZEL * 2) / COLS, (availH - BEZEL * 2) / (ROWS + 3.4))
  for (let i = 0; i < 4; i++) {
    c = Math.min((availW - BEZEL * 2) / COLS, (availH - BEZEL * 2 - readoutFor(c) - headerFor(c)) / ROWS)
  }
  CELL = Math.max(6, Math.floor(c))
  READOUT = readoutFor(CELL)
  HEADER = headerFor(CELL)
  TOP = BEZEL + HEADER

  const w = COLS * CELL + BEZEL * 2
  const h = ROWS * CELL + BEZEL * 2 + READOUT + HEADER
  const dpr = window.devicePixelRatio || 1
  canvas.width = w * dpr
  canvas.height = h * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // Last resort: if the smallest honest layout still will not fit, scale the
  // element down in CSS. Nothing ever scrolls.
  cssScale = Math.min(1, availW / w, availH / h)
  logicalW = w
  logicalH = h
  canvas.style.width = `${Math.floor(w * cssScale)}px`
  canvas.style.height = `${Math.floor(h * cssScale)}px`
}
document.addEventListener('visibilitychange', () => { hidden = document.hidden })

// During development a stale tab keeps calling with old code. Notice and reload.
let buildId = null
async function checkServer() {
  try {
    const r = await (await fetch('/api/version')).json()
    ready = r.ready
    if (buildId === null) buildId = r.build
    else if (r.build !== buildId) location.reload()
  } catch { ready = false }
}
checkServer()
setInterval(checkServer, 3000)

window.addEventListener('resize', layout)
window.visualViewport?.addEventListener('resize', layout)
layout()

// ── colour helpers ────────────────────────────────────────────────────────────
function shade(hex, mul) {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v * mul))))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ── the two materials ─────────────────────────────────────────────────────────
// Committed blocks are plastic: bevelled, physical, the past.
// Brightness records how certain the machine was at the moment it placed them,
// so the wall you are looking at is a record of its doubt.
function drawBlock(cx, cy, color, certainty) {
  const k = Math.max(0, Math.min(1, ((certainty ?? 0.45) - 0.15) / 0.55))
  const b = 0.32 + 0.78 * k
  const x = BEZEL + cx * CELL
  const y = TOP + cy * CELL
  const p = Math.max(1, CELL * 0.06)
  ctx.fillStyle = shade(color, 0.62 * b)
  roundRect(x + 1, y + 1, CELL - 2, CELL - 2, Math.max(2, CELL * 0.1))
  ctx.fill()
  ctx.fillStyle = shade(color, 1.0 * b)
  roundRect(x + 1 + p, y + 1 + p, CELL - 2 - p * 2, CELL - 2 - p * 2, Math.max(1, CELL * 0.07))
  ctx.fill()
  ctx.fillStyle = shade(color, 1.28 * b)
  roundRect(x + 1 + p, y + 1 + p, CELL - 2 - p * 2, Math.max(1, CELL * 0.1), 1)
  ctx.fill()
}

// Wanting is not plastic: flat light, no edges, no bevel.
function drawGlow(cx, cy, color, alpha) {
  const x = BEZEL + cx * CELL
  const y = TOP + cy * CELL
  ctx.save()
  ctx.shadowColor = rgba(color, Math.min(0.95, alpha * 1.2))
  ctx.shadowBlur = CELL * (0.35 + 0.9 * alpha)
  ctx.fillStyle = rgba(color, alpha)
  roundRect(x + 2, y + 2, CELL - 4, CELL - 4, Math.max(2, CELL * 0.12))
  ctx.fill()
  ctx.restore()
}

function drawOutline(cells, color, alpha, weight = 1) {
  ctx.save()
  ctx.strokeStyle = rgba(color, alpha)
  ctx.lineWidth = Math.max(1, CELL * 0.055 * weight)
  ctx.shadowColor = rgba(color, alpha * 0.8)
  ctx.shadowBlur = CELL * 0.5
  for (const [cx, cy] of cells) {
    if (cy < 0) continue
    roundRect(BEZEL + cx * CELL + 2.5, TOP + cy * CELL + 2.5, CELL - 5, CELL - 5, Math.max(2, CELL * 0.12))
    ctx.stroke()
  }
  ctx.restore()
}

// ── game state ────────────────────────────────────────────────────────────────
let board, bag, current, next, score, lines, pieces, dead
let field = null        // id -> blended probability
let cellField = null    // "x,y" -> normalised probability
let top3 = []
let chosen = null
let phase = 'boot'      // boot | thinking | field | dropping | settle | over
let phaseStart = 0
let lastMs = 0
let lastConf = 0
let thinkingSince = 0
let meta = null   // model id, call count, tokens, cost — straight from the API
let showHelp = false
let showDecision = false
let decision = null   // the last answer, kept so it can be read
let optionCount = 0   // how many placements the code handed over this turn
let chosenId = null   // which one it picked, by the label the code gave it
let chosenShare = 0   // how much of the blended field landed on that one
let netError = null   // a failed call is not a lost game
// Every game is a generation. A step that belongs to an older one stops at its
// next await, so a restart can never leave two loops running at once.
let gen = 0
let hitboxes = []          // rebuilt every frame; canvas has no DOM to click
let history = loadHistory()

function loadHistory() {
  try { return JSON.parse(localStorage.getItem('glow.history') || '[]') } catch { return [] }
}
function remember(round) {
  history = [round, ...history].slice(0, 40)
  try { localStorage.setItem('glow.history', JSON.stringify(history)) } catch {}
}
const best = () => history.reduce((m, r) => Math.max(m, r.score), 0)
let dropFrom = 0

// the board exists before anyone presses START
function blank() {
  board = emptyBoard()
  score = 0; lines = 0; pieces = 0; dead = false
  field = null; cellField = null; top3 = []; chosen = null
  decision = null; optionCount = 0; chosenId = null
}

function reset() {
  gen++
  board = emptyBoard()
  bag = makeBag(SEED + pieces0++)
  current = bag()
  next = bag()
  score = 0; lines = 0; pieces = 0; dead = false
  field = null; cellField = null; top3 = []; chosen = null
  setPhase('thinking')
}
let pieces0 = 0

function setPhase(p) { phase = p; phaseStart = performance.now() }

// ── asking ────────────────────────────────────────────────────────────────────
async function askForMove(placements) {
  const { criteria } = describePlacements(board, placements)
  const state = describeBoard(board, current, next)
  const res = await fetch('/api/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, questions: buildQuestions(criteria) }),
    signal: AbortSignal.timeout(20000),   // a hung socket is a failure, not a wait
  })
  const raw = await res.json().catch(() => ({ error: `server returned ${res.status}` }))
  if (raw.budget) { budgetStop = raw.error; throw new Error(raw.error) }
  if (!res.ok) throw new Error(raw.error || `server returned ${res.status}`)
  if (raw.error) throw new Error(raw.error)
  if (raw._glow) meta = { model: raw.model ?? raw._glow.cumulative.model, ...raw._glow.cumulative }

  const ids = placements.map((p) => p.id)
  const dists = {}
  const confs = []
  for (const name of Object.keys(VOICES)) {
    const a = raw?.answers?.[name]
    if (!a) continue
    dists[name] = a.probabilities ?? {}
    if (a.confidence != null) confs.push(a.confidence)
  }
  // No usable answers means we are not playing — it must not fall through to
  // an all-zero blend, which would silently place the first option every turn
  // and keep paying for it.
  if (Object.keys(dists).length === 0) throw new Error('no answers in the response')
  const blended = blend(dists, ids)
  const order = [...ids].sort((a, b) => blended[b] - blended[a])

  decision = {
    piece: current,
    total: ids.length,
    options: order.map((id) => {
      const voices = {}
      let contributed = 0
      let topVoice = null
      for (const [name, v] of Object.entries(VOICES)) {
        const prob = dists[name]?.[id] ?? 0
        voices[name] = prob
        const c = prob * v.weight
        if (c > contributed) { contributed = c; topVoice = name }
      }
      return { id, text: criteria[id], voices, blended: blended[id], topVoice, contributed }
    }),
  }

  return {
    field: blended,
    share: blended[order[0]] ?? 0,
    pick: placements.find((p) => p.id === order[0]),
    top3: order.slice(0, 3).map((id) => placements.find((p) => p.id === id)),
    confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0,
  }
}

function buildCellField(placements, blended) {
  const acc = new Map()
  let max = 0
  for (const p of placements) {
    const v = blended[p.id] ?? 0
    if (v <= 0) continue
    for (const [x, y] of p.cells) {
      if (y < 0) continue
      const k = `${x},${y}`
      const prev = acc.get(k) ?? 0
      const nv = FIELD_MODE === 'max' ? Math.max(prev, v) : prev + v
      acc.set(k, nv)
      if (nv > max) max = nv
    }
  }
  if (max > 0) for (const [k, v] of acc) acc.set(k, v / max)
  return acc
}

// ── the loop ──────────────────────────────────────────────────────────────────
function die() {
  if (dead) return
  gen++
  dead = true
  setPhase('over')
  if (pieces > 0) remember({ score, lines, pieces, t: Date.now() })
  if (AUTO) setTimeout(start, 5000)
}

async function step() {
  const g = gen
  const stale = () => g !== gen

  const placements = enumeratePlacements(board, current)
  if (placements.length === 0) { die(); return }
  optionCount = placements.length

  setPhase('thinking')
  thinkingSince = performance.now()
  let result
  while (hidden && !stale()) { setPhase('idle'); await wait(400) }
  if (stale()) return

  for (let attempt = 0; ; attempt++) {
    try {
      result = await askForMove(placements)
      if (stale()) return
      netError = null
      break
    } catch (e) {
      // The server being down is not a game over. Say so, wait, try again.
      netError = e.message || 'could not reach the model'
      console.warn('call failed:', netError)
      if (stale()) return
      if (budgetStop) { setPhase('stalled'); return }
      if (attempt >= 4) { setPhase('stalled'); return }
      await wait(1200 * (attempt + 1))
      if (stale()) return
      setPhase('thinking')
      thinkingSince = performance.now()
    }
  }
  lastMs = Math.round(performance.now() - thinkingSince)
  waits.push(lastMs)
  if (waits.length > 12) waits.shift()
  lastConf = result.confidence
  chosenId = result.pick?.id ?? null
  chosenShare = result.share ?? 0
  field = result.field
  cellField = buildCellField(placements, field)
  top3 = result.top3
  chosen = result.pick

  setPhase('field')
  await wait(HOLD)
  if (stale()) return

  dropFrom = -2
  setPhase('dropping')
  await wait(150)
  if (stale()) return

  const { board: after, cleared } = applyPlacement(board, chosen, { type: current, conf: lastConf })
  board = after
  lines += cleared
  score += LINE_SCORE[cleared] * 1
  pieces++
  cellField = null; top3 = []; field = null

  setPhase('settle')
  await wait(cleared ? 160 : 70)
  if (stale()) return

  current = next
  next = bag()
  return step()
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ── render ────────────────────────────────────────────────────────────────────
function render(t) {
  const w = COLS * CELL + BEZEL * 2
  const h = ROWS * CELL + BEZEL * 2 + READOUT + HEADER   // must match layout()
  hitboxes = []

  ctx.fillStyle = C.ground
  ctx.fillRect(0, 0, w, h)

  ctx.fillStyle = C.bezel
  roundRect(0.5, 0.5, w - 1, h - 1, 16)
  ctx.fill()
  ctx.strokeStyle = C.bezelEdge
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.fillStyle = C.well
  roundRect(BEZEL, TOP, COLS * CELL, ROWS * CELL, 3)
  ctx.fill()

  ctx.strokeStyle = C.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 1; x < COLS; x++) {
    ctx.moveTo(BEZEL + x * CELL + 0.5, TOP)
    ctx.lineTo(BEZEL + x * CELL + 0.5, TOP + ROWS * CELL)
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.moveTo(BEZEL, TOP + y * CELL + 0.5)
    ctx.lineTo(BEZEL + COLS * CELL, TOP + y * CELL + 0.5)
  }
  ctx.stroke()

  const since = t - phaseStart
  const color = PIECE_COLOR[current] ?? '#888'
  const bloom = Math.min(1, since / 160)

  // The wanting goes UNDER the stack. Glow bleeds past its own cell, and drawn
  // on top it tinted settled blocks, which made occupied squares look like
  // candidates. Light in the air, occluded by matter.
  if (phase === 'field' && cellField) {
    for (const [k, p] of cellField) {
      if (p < FIELD_FLOOR) continue
      const [x, y] = k.split(',').map(Number)
      drawGlow(x, y, color, Math.pow(p, FIELD_GAMMA) * 0.9 * bloom)
    }
  }

  // the past
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cell = board?.[y]?.[x]
      if (!cell) continue
      const c = PIECE_COLOR[cell.type] ?? '#888'
      if (dead) drawBlock(x, y, '#7e7e7e', (cell.conf ?? 0.45) * 0.62)
      else drawBlock(x, y, c, cell.conf ?? 0.5)
    }
  }

  // the chosen one, over everything
  if (phase === 'field' && cellField) {
    top3.forEach((p, i) => {
      if (!p) return
      if (i === 0) drawOutline(p.cells, '#ffffff', 0.9 * bloom, 1.7)
      else drawOutline(p.cells, color, [0, 0.45, 0.24][i] * bloom, 1)
    })
  }

  // waiting for an answer: the piece hangs at the gate, breathing
  if (phase === 'thinking' && current) {
    const m = PIECES[current][0]
    const ox = Math.floor((COLS - m[0].length) / 2)
    const pulse = 0.16 + 0.13 * Math.sin(t / 300)
    for (let yy = 0; yy < m.length; yy++) {
      for (let xx = 0; xx < m[yy].length; xx++) {
        if (m[yy][xx]) drawGlow(ox + xx, yy, color, pulse)
      }
    }
  }

  // the drop
  if (phase === 'dropping' && chosen) {
    const k = Math.min(1, since / 150)
    const e = 1 - Math.pow(1 - k, 3)
    const topY = Math.min(...chosen.cells.map(([, cy]) => cy))
    const dy = (topY - dropFrom) * (1 - e)
    for (const [cx, cy] of chosen.cells) {
      const y = cy - dy
      if (y < -0.9) continue
      drawBlock(cx, y, color, lastConf)
    }
  }

  if (phase === 'settle' && chosen) {
    const k = 1 - Math.min(1, since / 120)
    for (const [cx, cy] of chosen.cells) if (cy >= 0) drawGlow(cx, cy, '#ffffff', k * 0.35)
  }

  drawHeader(w)
  drawReadout(w, h, t)
  if (showHelp) drawHelp()
  else if (showDecision && decision) drawDecision()
  else if (!started) drawAttract()
  else if (phase === 'stalled') drawStalled()
  else if (dead) drawGameOver()
  requestAnimationFrame(render)
}

// ── panels ────────────────────────────────────────────────────────────────────
// One overlay at a time, covering the playing area exactly. Everything is
// wrapped and clipped to the well, so no line can run outside the frame.
const mono = (px, weight = 400) => `${weight} ${px}px ui-monospace, SFMono-Regular, Menlo, monospace`
const U = () => Math.max(7, Math.round(CELL * 0.34))

function wrap(text, maxW) {
  const lines = []
  for (const para of String(text).split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = word }
      else line = next
    }
    lines.push(line)
  }
  return lines
}

let pressed = { action: null, at: 0 }
let hover = null   // canvas has no elements, so hover is tracked by hand
const waits = []   // the last few latencies, for the comb
let started = false
let budgetStop = null   // set when the server refuses on cost grounds
let hidden = document.hidden
let ready = null   // null until the server has been asked whether it has a key

const PAD = 6   // the hit area, and the hover area, extend this far past the chip

function inButton(pt, x, y, w, h) {
  return !!pt && pt.x >= x - PAD && pt.x <= x + w + PAD && pt.y >= y - PAD && pt.y <= y + h + PAD
}

function button(label, x, y, w, h, action, tone = 'normal') {
  const hot = pressed.action === action && performance.now() - pressed.at < 140
  const over = inButton(hover, x, y, w, h)
  const quiet = tone === 'quiet'
  ctx.fillStyle = hot ? '#4f4f4f' : over ? (quiet ? '#333333' : '#3e3e3e') : quiet ? 'transparent' : '#343434'
  roundRect(x, y, w, h, 4)
  if (hot || over || !quiet) ctx.fill()
  ctx.strokeStyle = over ? '#7d7d7d' : quiet ? '#4a4a4a' : '#585858'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = over ? '#f0f0f0' : quiet ? '#8e8e8e' : '#d0d0d0'
  ctx.font = mono(Math.max(7, U() * 0.72), 500)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + w / 2, y + h / 2 + 0.5)
  ctx.textAlign = 'left'
  hitboxes.push({ x: x - PAD, y: y - PAD, w: w + PAD * 2, h: h + PAD * 2, action })
}

function openPanel(title) {
  const x = BEZEL
  const y = TOP
  const w = COLS * CELL
  const h = ROWS * CELL
  ctx.save()
  roundRect(x, y, w, h, 3)
  ctx.fillStyle = 'rgba(25,25,25,0.985)'
  ctx.fill()
  ctx.strokeStyle = '#3a3a3a'
  ctx.lineWidth = 1
  ctx.stroke()
  roundRect(x, y, w, h, 3)
  ctx.clip()

  const pad = Math.max(10, U() * 1.5)
  const close = U() * 2.3
  ctx.textBaseline = 'middle'

  const panel = {
    x: x + pad,
    maxW: w - pad * 2 - close,
    bottom: y + h - pad - U() * 1.6,
    y: y + pad + U() * 0.9,
    clipped: false,
    line(text, opts = {}) {
      const { size = 0.85, color = '#8e8e8e', gap = 1.2, ls = '0px', weight = 400, indent = 0 } = opts
      if (this.y > this.bottom) { this.clipped = true; return this }
      ctx.font = mono(Math.max(7, U() * size), weight)
      ctx.letterSpacing = ls
      ctx.fillStyle = color
      for (const ln of wrap(text, this.maxW - indent)) {
        if (this.y > this.bottom) { this.clipped = true; break }
        ctx.fillText(ln, this.x + indent, this.y)
        this.y += U() * gap
      }
      ctx.letterSpacing = '0px'
      return this
    },
    space(k = 1) { this.y += U() * k; return this },
    room() { return this.bottom - this.y },
  }

  panel.line(title, { size: 1.0, color: '#a4a4a4', weight: 500, ls: '2.5px', gap: 1.9 })
  button('×', x + w - pad - close, y + pad * 0.7, close, close, 'close', 'quiet')
  ctx.textBaseline = 'middle'
  return panel
}

function closePanel(panel) {
  if (panel.clipped) {
    ctx.font = mono(Math.max(7, U() * 0.8))
    ctx.fillStyle = '#6a6a6a'
    ctx.fillText('…', panel.x, panel.bottom + U() * 1.1)
  }
  ctx.restore()
}

// dead centre of the well, horizontally and vertically
function centreButton(label, action) {
  const w = COLS * CELL
  const h = ROWS * CELL
  ctx.font = mono(Math.max(10, U() * 1.2), 500)
  const bw = ctx.measureText(label).width + U() * 4.5
  const bh = Math.max(30, U() * 3)
  button(label, BEZEL + (w - bw) / 2, TOP + (h - bh) / 2, bw, bh, action)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
}

function drawAttract() {
  const w = COLS * CELL
  const h = ROWS * CELL
  ctx.save()
  roundRect(BEZEL, TOP, w, h, 3)
  ctx.fillStyle = 'rgba(22,22,22,0.55)'
  ctx.fill()
  ctx.restore()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = mono(Math.max(9, U() * 0.88), 500)
  ctx.fillStyle = '#6a6a6a'
  ctx.letterSpacing = '3px'
  ctx.letterSpacing = '0px'

  // Without a key there is nothing to press. Say why, do not offer START.
  if (ready === false) {
    ctx.font = mono(Math.max(10, U() * 1.05), 500)
    ctx.fillStyle = '#bb4a44'
    ctx.letterSpacing = '2px'
    ctx.fillText('NO API KEY', BEZEL + w / 2, TOP + h * 0.5 - U() * 2.2)
    ctx.letterSpacing = '0px'
    ctx.font = mono(Math.max(8, U() * 0.82))
    ctx.fillStyle = '#7a7a7a'
    ctx.fillText('put TYPESAFE_API_KEY in .env and restart the server,', BEZEL + w / 2, TOP + h * 0.5 + U() * 0.2)
    ctx.fillText('or run it without one:', BEZEL + w / 2, TOP + h * 0.5 + U() * 1.5)
    ctx.fillStyle = '#c8a04a'
    ctx.fillText('node server.js --mock', BEZEL + w / 2, TOP + h * 0.5 + U() * 2.9)
    ctx.textAlign = 'left'
    return
  }

  ctx.textAlign = 'left'
  if (ready) centreButton('START', 'start')
}

function drawStalled() {
  const p = openPanel(budgetStop ? 'BUDGET REACHED' : 'NO ANSWER')
  p.line('The model did not answer. This is a broken connection, not a lost game — the board is exactly as it was.',
    { size: 0.86, color: '#9d9d9d', gap: 1.3 })
  p.space(0.6)
  p.line(netError ?? 'unknown error', { size: 0.78, color: '#bb4a44', gap: 1.3 })
  p.space(0.6)
  if (budgetStop) {
    p.line('This is the spend limit, not a fault. Raise GLOW_MAX_CALLS or GLOW_MAX_USD and restart the server.',
      { size: 0.78, color: '#6a6a6a', gap: 1.4 })
  } else {
    p.line('Check the server is running, then try again.', { size: 0.78, color: '#6a6a6a', gap: 1.4 })
    p.space(0.5)
    button('TRY AGAIN', p.x, p.y, U() * 11, U() * 2.4, 'retry')
  }
  closePanel(p)
}

function drawGameOver() {
  const x = BEZEL
  const y = TOP
  const w = COLS * CELL
  const h = ROWS * CELL
  ctx.save()
  roundRect(x, y, w, h, 3)
  ctx.fillStyle = 'rgba(22,22,22,0.9)'   // the grey wall stays visible behind
  ctx.fill()
  roundRect(x, y, w, h, 3)
  ctx.clip()
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'

  const cx = x + w / 2
  const big = Math.min(U() * 2.8, (w * 0.86) / (8 * 0.78))
  let cy = y + h * 0.16

  ctx.font = mono(big, 700)
  ctx.letterSpacing = `${Math.round(big * 0.12)}px`
  ctx.fillStyle = '#d8b24a'
  ctx.fillText('HEY JEV,', cx, cy)
  cy += big * 1.25
  ctx.fillStyle = '#bb4a44'
  ctx.fillText('YOU LOST', cx, cy)
  ctx.letterSpacing = '0px'

  const isBest = score > 0 && score >= best()
  cy += big * 1.5
  ctx.font = mono(Math.max(9, U()), 500)
  ctx.fillStyle = isBest ? '#d8b24a' : '#c4c4c4'
  ctx.fillText(`${String(score).padStart(5, '0')}   ${String(lines).padStart(3, '0')} LINES   ${pieces} PIECES`, cx, cy)
  if (isBest) {
    cy += U() * 1.7
    ctx.fillStyle = '#d8b24a'
    ctx.letterSpacing = '2px'
    ctx.fillText('A NEW BEST', cx, cy)
    ctx.letterSpacing = '0px'
  }

  const rounds = [...history].sort((a, b) => b.score - a.score).slice(0, 5)
  if (rounds.length) {
    cy = y + h * 0.62
    ctx.font = mono(Math.max(8, U() * 0.82), 500)
    ctx.fillStyle = '#5f5f5f'
    ctx.letterSpacing = '2px'
    ctx.fillText('TOP ROUNDS', cx, cy)
    ctx.letterSpacing = '0px'
    cy += U() * 1.9
    ctx.font = mono(Math.max(8, U() * 0.86))
    rounds.forEach((r, i) => {
      const mine = r.score === score && r.pieces === pieces
      ctx.fillStyle = mine ? '#d8b24a' : '#6a6a6a'
      ctx.fillText(`${i + 1}   ${String(r.score).padStart(5, '0')}   ${String(r.lines).padStart(3, '0')} LINES`, cx, cy)
      cy += U() * 1.6
    })
  }

  ctx.textAlign = 'left'
  ctx.restore()
  centreButton('START', 'start')
}

const HELP = [
  ['WHO IS PLAYING', 'The code finds every legal place the piece could land and writes each one out as a sentence. JEV — a model that answers typed questions and cannot write — reads those sentences and picks one. It never sees the board, or a single number. Scramble its answers and the game plays no better than random.'],
  ['SCORE / LINES', 'the usual: 40 / 100 / 300 / 1200 per one to four lines.'],
  ['MS AND THE COMB', 'how long the model took, and the last few waits beside it against a fixed one-second scale. The piece cannot fall until the answer arrives, so the comb is the tempo of the game made visible.'],
  ['THE GLOW', 'every legal place this piece could land. A cell is lit by the total probability of every candidate that would fill it — the chance it ends up occupied, not one proposed shape. There is no lookahead in it at all. Add ?field=max to light each cell by its single strongest candidate instead.'],
  ['WHITE OUTLINE', 'the placement that won.'],
  ['BLOCK BRIGHTNESS', 'how sure the model was when it placed that block — the mean confidence across its five questions for that move. The finished wall is a record of its doubt, and it is the only place confidence is shown on the board.'],
  ['#N · N%', 'which placement it took, and how much of its wanting landed there. Places are numbered left to right, so #1 is the leftmost the piece can land — a low number means it went left. The percentage is that one option\'s share of the whole field: 80% is a machine that knew, 20% is a machine spreading itself thin across many options that looked alike.'],
  ['THE BIG LINE', 'tap it to see the last move in full: every placement the code offered, the probability the model gave each one, which of its five questions decided it, and what the session has cost.'],
  ['THE COMB', 'the last few waits, oldest on the left, the current one growing live on the right, all against a fixed one-second scale. A tall spike is a slow think; a flat run is the machine in rhythm.'],
]

function drawHelp() {
  const p = openPanel('WHAT YOU ARE LOOKING AT')
  for (const [label, text] of HELP) {
    if (p.room() < U() * 3) break
    p.line(label, { size: 0.82, color: '#c8a04a', weight: 500, ls: '1.5px', gap: 1.35 })
    p.line(text, { size: 0.82, color: '#8e8e8e', gap: 1.2 })
    p.space(0.6)
  }
  closePanel(p)
}

function drawHeader(w) {
  const wellW = COLS * CELL
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const cx = BEZEL + wellW / 2

  ctx.font = mono(Math.max(16, CELL * 0.82), 700)
  ctx.letterSpacing = `${Math.max(1, CELL * 0.02).toFixed(1)}px`
  ctx.fillStyle = dead ? '#8a8a8a' : '#e0e0e0'
  ctx.fillText(String(score).padStart(5, '0'), cx, TOP - Math.max(12, CELL * 0.42))

  ctx.font = mono(Math.max(8, CELL * 0.3), 500)
  ctx.letterSpacing = `${Math.max(1, CELL * 0.03).toFixed(1)}px`
  const sub = best() > 0 ? `${String(lines).padStart(3, '0')} LINES · BEST ${String(best()).padStart(5, '0')}` : `${String(lines).padStart(3, '0')} LINES`
  ctx.fillStyle = '#5f5f5f'
  ctx.fillText(sub, cx, TOP - Math.max(3, CELL * 0.1))

  ctx.letterSpacing = '0px'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
}

// ── the strip ─────────────────────────────────────────────────────────────────
// Direction 1A. One oversized line carries the whole idea: a count of places on
// the left, one choice on the right, an arrow drawn from code to model. Nothing
// else is allowed to be that big. Cost and call count are gone from screen and
// live at the foot of the DECISION panel instead.
//
// Geometry is the spec's, at 530 wide desktop / 290 phone, scaled to the well.
// All y values are element TOPS, so the strip draws with textBaseline 'top'.
const LATENCY_CEILING = 1200   // fixed, never auto-scaled, or the comb lies

function drawReadout(w, h, t) {
  const wellW = COLS * CELL
  const sp = stripSpec(wellW)
  const k = wellW / sp.base
  const m = (v) => v * k
  const x0 = BEZEL
  const y0 = h - READOUT
  const left = x0 + m(sp.pad)
  const right = x0 + wellW - m(sp.pad)
  const thinking = phase === 'thinking'
  const ms = thinking ? Math.round(t - thinkingSince) : lastMs

  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  const type = (px, weight, em) => {
    ctx.font = mono(Math.max(7, m(px)), weight)
    ctx.letterSpacing = `${(m(px) * em).toFixed(2)}px`
  }
  const put = (text, x, y, color, align = 'left') => {
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(text, x, y)
    ctx.textAlign = 'left'
  }

  // bezel rule
  ctx.fillStyle = '#2f2f2f'
  ctx.fillRect(x0, y0, wellW, 1)

  const live = started && !dead

  if (live) {
    type(sp.label, 600, 0.16)
    put('CODE FOUND', left, y0 + m(sp.labelY), '#6e6e6e')
    put(thinking ? 'JEV IS READING' : 'JEV PICKED', right, y0 + m(sp.labelY), '#c8a04a', 'right')

    type(sp.hero, 700, 0.01)
    put(`${String(optionCount).padStart(2, '0')} PLACES`, left, y0 + m(sp.heroY), '#c4c4c4')
    if (thinking) {
      const on = Math.floor(ms / 550) % 2 === 0
      put('·  ·  ·', right, y0 + m(sp.heroY), on ? '#c8a04a' : '#4a4a4a', 'right')
    } else {
      // Placements are numbered left to right, so the number is positional:
      // #1 is the leftmost place this piece can land. Right-aligned, so the
      // digits grow leftward and nothing else moves.
      const n = chosenId ? Number(chosenId.slice(1)) + 1 : 0
      put(`#${n} · ${Math.round(chosenShare * 100)}%`, right, y0 + m(sp.heroY), '#c8a04a', 'right')
    }

    // the arrow is the explanation
    const shaft = thinking ? '#3a3a3a' : '#4a4a4a'
    ctx.fillStyle = shaft
    ctx.fillRect(x0 + m(sp.arrowFrom), y0 + m(sp.arrowY) + m(4), m(sp.arrowTo - sp.arrowFrom), 1)
    ctx.beginPath()
    ctx.moveTo(x0 + m(sp.arrowHead), y0 + m(sp.arrowY) + m(4.5))
    ctx.lineTo(x0 + m(sp.arrowHead) - m(8), y0 + m(sp.arrowY))
    ctx.lineTo(x0 + m(sp.arrowHead) - m(8), y0 + m(sp.arrowY) + m(9))
    ctx.closePath()
    ctx.fill()

    // SURE is gone from the strip. Confidence still lives in two places that
    // earn it: the DECISION panel, and the brightness of every block the
    // machine has placed — the wall is the record.
    // the comb: the last nine waits, rightmost live. Dead time becomes rhythm.
    const combH = m(sp.combBase - sp.combTop)
    const barW = Math.max(1, m(2))
    const gap = Math.max(1, m(2))
    const shown = [...waits.slice(-(sp.bars - 1)), ms]
    for (let i = 0; i < shown.length; i++) {
      const v = Math.min(shown[i], LATENCY_CEILING) / LATENCY_CEILING
      const bh = Math.max(1, combH * v)
      const bxx = x0 + m(sp.combRight) - (shown.length - i) * (barW + gap)
      const isNow = i === shown.length - 1
      ctx.fillStyle = isNow ? '#c8a04a' : i >= shown.length - 3 ? '#6e6e6e' : '#4a4a4a'
      ctx.fillRect(bxx, y0 + m(sp.combBase) - bh, barW, bh)
    }

    type(sp.meter, 500, 0.10)
    put(`${String(ms).padStart(4, '0')}MS`, right, y0 + m(sp.meterY), thinking ? '#c8a04a' : '#8a8a8a', 'right')

    // the whole hero line is the way into the decision
    if (decision) {
      hitboxes.push({ x: left, y: y0 + m(sp.labelY), w: right - left, h: m(sp.meterY - sp.labelY), action: 'why' })
      if (pressed.action === 'why' && performance.now() - pressed.at < 160) {
        ctx.fillStyle = '#c8a04a'
        ctx.fillRect(left, y0 + m(sp.heroY) + m(sp.hero) + m(3), right - left, 1)
      }
    }
  }

  // divider and provenance
  ctx.fillStyle = '#2f2f2f'
  ctx.fillRect(left, y0 + m(sp.ruleY), right - left, 1)

  // one glyph, a generous hit box
  type(sp.meter, 500, 0)
  const qHit = Math.max(28, m(32))
  put('?', right, y0 + m(sp.qY), hover && inButton(hover, right - qHit / 2, y0 + m(sp.qY) - qHit / 2 + m(6), qHit, qHit) ? '#c8a04a' : '#6e6e6e', 'right')
  hitboxes.push({ x: right - qHit, y: y0 + m(sp.qY) - qHit / 2, w: qHit, h: qHit, action: 'help' })

  ctx.letterSpacing = '0px'
  ctx.textBaseline = 'middle'
}

function tokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(n)
}

window.__glow = () => ({ phase, pieces, lines, score, lastConf, lastMs, dead })
window.__test = { die: () => die(), state: () => ({ phase, dead, started, pieces, score, lines, netError, history: history.length,
    cell: CELL, well: COLS * CELL, strip: READOUT, header: HEADER, top: TOP,
    boardBottom: TOP + ROWS * CELL, stripTop: logicalH - READOUT,
    canvas: [logicalW, logicalH], scale: cssScale }) }
window.__hit = () => hitboxes.map((b) => ({ ...b }))
window.__click = (action) => {
  const b = hitboxes.find((x) => x.action === action)
  if (!b) return 'no such button: ' + action
  const r = canvas.getBoundingClientRect()
  canvas.dispatchEvent(new MouseEvent('click', {
    clientX: r.left + (b.x + b.w / 2) * (r.width / logicalW),
    clientY: r.top + (b.y + b.h / 2) * (r.height / logicalH),
    bubbles: true,
  }))
  return 'clicked ' + action
}
window.__ui = { help: (v) => { showHelp = v; showDecision = false }, why: (v) => { showDecision = v; showHelp = false } }

// ── go ────────────────────────────────────────────────────────────────────────
function start() {
  started = true
  reset()
  step()
}

const toCanvas = (e) => {
  const r = canvas.getBoundingClientRect()
  return { x: (e.clientX - r.left) * (logicalW / r.width), y: (e.clientY - r.top) * (logicalH / r.height) }
}
const atPoint = (pt) => hitboxes.find((b) => pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h)

canvas.addEventListener('mousemove', (e) => {
  hover = toCanvas(e)
  canvas.style.cursor = atPoint(hover) ? 'pointer' : 'default'
})
canvas.addEventListener('mouseleave', () => { hover = null; canvas.style.cursor = 'default' })

canvas.addEventListener('click', (e) => {
  const hit = atPoint(toCanvas(e))
  if (!hit) { showHelp = false; showDecision = false; return }
  pressed = { action: hit.action, at: performance.now() }
  if (hit.action === 'help') { showHelp = !showHelp; showDecision = false }
  if (hit.action === 'why') { showDecision = !showDecision; showHelp = false }
  if (hit.action === 'close') { showHelp = false; showDecision = false }
  if (hit.action === 'restart') { showHelp = false; showDecision = false; start() }
  if (hit.action === 'start') { showHelp = false; showDecision = false; start() }
  if (hit.action === 'retry') { netError = null; showHelp = false; showDecision = false; if (!dead) step() }
})
window.addEventListener('keydown', (e) => {
  if (e.key === '?' || e.key === 'h') { showHelp = !showHelp; showDecision = false }
  if (e.key === 'd') { showDecision = !showDecision; showHelp = false }
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (ready && (!started || dead)) start() }
  if (e.key === 'Escape') { showHelp = false; showDecision = false }
})

blank()
requestAnimationFrame(render)
if (AUTO) checkServer().then(() => { if (ready) start() })   // ?auto=1 skips the attract screen and loops


// ── the decision, as the model returned it ────────────────────────────────────
// Every number here came back from the API. The sentences are ours — they are
// what we asked about. The weights are ours too, and labelled as such.
const VOICE_KEY = { sealed: 'SEAL', clears: 'LINE', unburied: 'KEEP', low: 'LOW', flat: 'FLAT' }

function drawDecision() {
  const p = openPanel('WHY THIS MOVE')
  const best = decision.options[0]

  p.line(`The code offered ${decision.total} legal placements. Every probability below came back from the model.`,
    { size: 0.8, color: '#6a6a6a', gap: 1.25 })
  p.space(0.5)

  const share = best.blended > 0 ? Math.round((best.contributed / best.blended) * 100) : 0
  p.line(`Chose #${best.id.replace('p', '')} because "${VOICE_KEY[best.topVoice] ?? best.topVoice}" put ${best.voices[best.topVoice].toFixed(2)} on it — at weight ${VOICES[best.topVoice].weight} that is ${share}% of its blended total.`,
    { size: 0.8, color: '#c8a04a', gap: 1.25 })
  p.space(0.9)

  const cols = Object.keys(VOICE_KEY)
  const colW = Math.max(U() * 2.5, (p.maxW - U() * 7.5) / cols.length)
  const header = () => {
    ctx.font = mono(Math.max(7, U() * 0.78))
    ctx.letterSpacing = '1px'
    ctx.fillStyle = '#4e4e4e'
    ctx.fillText('PLACE', p.x, p.y)
    ctx.fillText('TOTAL', p.x + U() * 3.3, p.y)
    cols.forEach((n, i) => ctx.fillText(VOICE_KEY[n], p.x + U() * 7.5 + i * colW, p.y))
    ctx.letterSpacing = '0px'
    p.y += U() * 1.4
  }
  header()

  for (let i = 0; i < decision.options.length; i++) {
    const o = decision.options[i]
    if (p.room() < U() * 4.2) { p.clipped = true; break }
    const won = i === 0
    ctx.font = mono(Math.max(7, U() * 0.82), won ? 500 : 400)
    ctx.fillStyle = won ? '#e6e6e6' : '#8e8e8e'
    ctx.fillText(`${won ? '▸' : ' '}#${o.id.replace('p', '')}`, p.x, p.y)
    ctx.fillText(o.blended.toFixed(3), p.x + U() * 3.3, p.y)
    cols.forEach((n, k) => {
      const v = o.voices[n]
      ctx.fillStyle = v > 0.005 ? (won ? '#d8b24a' : '#7d7d7d') : '#3f3f3f'
      ctx.fillText(v > 0.005 ? v.toFixed(2) : '–', p.x + U() * 7.5 + k * colW, p.y)
    })
    p.y += U() * 1.25
    p.line(o.text, { size: 0.76, color: won ? '#9a9a9a' : '#5e5e5e', gap: 1.1, indent: U() * 1.2 })
    p.space(0.55)
  }

  // the economics live here, where a curious viewer finds them and a casual one
  // is not told what to care about
  if (meta) {
    p.space(0.4)
    p.line(`${meta.calls} calls · $${meta.usd.toFixed(3)} · ${tokens(meta.inputTokens)} input tokens · weights ours, probabilities the model's`,
      { size: 0.74, color: '#4e4e4e', gap: 1.15 })
  }
  closePanel(p)
}

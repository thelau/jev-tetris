import { COLS, ROWS, PIECES, emptyBoard, enumeratePlacements, applyPlacement, makeBag, spawnColumn, LINE_SCORE } from '/src/tetris.js'
import { describeBoard, describePlacements, buildQuestions, blend, VOICES } from '/src/describe.js'
import { begin as audioBegin, toggleMute, sfx } from '/audio.js'

const params = new URLSearchParams(location.search)
const HOLD = Number(params.get('hold') ?? 380)
const SEED = Number(params.get('seed') ?? Math.floor(Math.random() * 1e6))
const AUTO = params.get('auto') === '1'

// ── palette, exactly ─────────────────────────────────────────────────────────
const C = {
  ground: '#232323', grill: '#1f1f1f', board: '#151515', sheet: '#141414',
  bevel: '#3a3a3a', grid: '#1c1c1c',
  ink0: '#4a4a4a', ink1: '#6e6e6e', ink2: '#8a8a8a', ink3: '#9a9a9a',
  ink4: '#c4c4c4', ink5: '#e8e8e8', ink6: '#ffffff', hot: '#f4f4f4',
  jev: '#c8a04a', jevDim: '#8a6a32', red: '#b04a44',
}
const PIECE_COLOR = {
  I: '#8a8a8a', O: '#7a5a22', T: '#5a4a86', S: '#3a7a45',
  Z: '#8a3f3f', J: '#2f5e96', L: '#7a4a2e',
}
// The pointer, drawn on a 12-unit grid so it stays blocky at any scale.
const ARROW = (fill) => 'url("data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 12 12" shape-rendering="crispEdges">` +
  `<path d="M0 0 L0 10.5 L2.6 8 L4.3 11.6 L6.1 10.8 L4.5 7.3 L7.8 7.3 Z" fill="${fill}" stroke="#000" stroke-width="1"/>` +
  `</svg>`) + '") 0 0, default'
const CURSOR_IDLE = ARROW('#c4c4c4')
const CURSOR_LIVE = ARROW('#c8a04a')

const PS = "'Press Start 2P', monospace"
const VT = "'VT323', ui-monospace, monospace"

// ── geometry: one free variable ──────────────────────────────────────────────
const M = 14
const clamp = (lo, v, hi) => Math.max(lo, Math.min(v, hi))

function metrics(cell) {
  const W = 10 * cell
  const d = clamp(18, Math.round(0.66 * cell), 40)
  const Hh = Math.round(1.5 * d)
  const sv = clamp(14, Math.min(Math.round((W - 24) / 11.8), 26), 26)
  const Hs = W >= 300 ? Math.round(2.95 * sv + 50) : Math.round(2.1 * sv + 40)
  return { cell, W, d, Hh, sv, Hs, hero: sv, Hb: ROWS * cell, H: Hh + ROWS * cell + Hs }
}
const fits = (cell, vw, vh) => {
  const g = metrics(cell)
  return g.Hh + g.Hb + g.Hs <= vh - 2 * M && g.W <= vw - 2 * M
}

const canvas = document.getElementById('stage')
const view = canvas.getContext('2d')
const buf = document.createElement('canvas')      // everything that may bloom
const ctx = buf.getContext('2d')

let G = metrics(30)
let dpr = 2
let grillPattern = null

function layout() {
  const vv = window.visualViewport
  const vw = vv?.width ?? window.innerWidth
  const vh = vv?.height ?? window.innerHeight
  let cell = 8
  for (let c = 8; c <= 80; c++) if (fits(c, vw, vh)) cell = c
  G = metrics(cell)
  dpr = 2
  for (const cv of [canvas, buf]) {
    cv.width = G.W * dpr
    cv.height = G.H * dpr
  }
  document.documentElement.style.cursor = CURSOR_IDLE
  canvas.style.width = `${G.W}px`
  canvas.style.height = `${G.H}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  view.setTransform(dpr, 0, 0, dpr, 0, 0)
  grillPattern = null

  // Each hero owns half the strip. Size the pair once, from the longest string
  // either side will ever hold, measured in the real face — Press Start 2P is
  // full-width and nothing else predicts it. A short word then never renders
  // larger than a long one.
  const half = (G.W - 2 * pad() - G.sv * 0.5) / 2
  ctx.font = `400 ${G.sv}px ${PS}`
  const widest = Math.max(
    ctx.measureText('ADD CREDITS').width,
    ctx.measureText('#34 · 100%').width,
    ctx.measureText('ALL WAYS').width,
  )
  G.hero = Math.max(8, Math.min(G.sv, Math.floor(G.sv * Math.min(1, half / widest))))
}
window.addEventListener('resize', layout)
window.visualViewport?.addEventListener('resize', layout)

// derived, read everywhere
const pad = () => Math.round(G.sv * 0.5)
const boardTop = () => G.Hh
const stripTop = () => G.Hh + G.Hb
const showBest = () => G.W >= 440
const showLines = () => G.W >= 270
const tight = () => G.W < 300
const minimal = () => G.W < 240
const labelSize = () => (G.W < 330 ? 0.4 : 0.54) * G.sv
const labelTrack = () => (G.W < 330 ? 0.1 : 0.16)

// ── state ────────────────────────────────────────────────────────────────────
let board, bag, current, next, score, lines, pieces, dead
let field = null, cellField = null, chosen = null, runnerUp = null
let phase = 'boot', phaseStart = 0, gen = 0
let lastMs = 0, lastConf = 0, thinkingSince = 0, dropFrom = 0
let gateRow = 1
let optionCount = 0, chosenId = null, chosenShare = 0, nearMiss = false, nearMissAt = 0
let meta = null, netError = null, budgetStop = null
let started = false, ready = null, hidden = document.hidden
let showPanel = false
let hitboxes = []
let hovered = null          // pointer devices only; touch never sets this
let pointer = false
let history = loadHistory()
let fontsReady = false

function loadHistory() {
  try { return JSON.parse(localStorage.getItem('glow.history') || '[]') } catch { return [] }
}
function remember(r) {
  history = [r, ...history].slice(0, 40)
  try { localStorage.setItem('glow.history', JSON.stringify(history)) } catch {}
}
const best = () => history.reduce((m, r) => Math.max(m, r.score), 0)

function blank() {
  board = emptyBoard()
  score = 0; lines = 0; pieces = 0; dead = false
  field = null; cellField = null; chosen = null; runnerUp = null
  optionCount = 0; chosenId = null; chosenShare = 0; nearMiss = false
}
function reset() {
  gen++
  blank()
  bag = makeBag(SEED + gen)
  current = bag()
  next = bag()
  setPhase('thinking')
}
const setPhase = (p) => { phase = p; phaseStart = performance.now() }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ── asking ───────────────────────────────────────────────────────────────────
async function askForMove(placements) {
  const { criteria } = describePlacements(board, placements)
  const state = describeBoard(board, current, next)
  sfx.ask()
  const res = await fetch('/api/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, questions: buildQuestions(criteria) }),
    signal: AbortSignal.timeout(20000),
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
  if (Object.keys(dists).length === 0) throw new Error('no answers in the response')

  const blended = blend(dists, ids)
  const order = [...ids].sort((a, b) => blended[b] - blended[a])
  return {
    field: blended,
    share: blended[order[0]] ?? 0,
    margin: (blended[order[0]] ?? 0) - (blended[order[1]] ?? 0),
    pick: placements.find((p) => p.id === order[0]),
    second: placements.find((p) => p.id === order[1]) ?? null,
    confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0,
  }
}

function buildCellField(placements, blended) {
  const acc = new Map()
  let max = 0
  for (const p of placements) {
    const v = blended[p.id] ?? 0
    for (const [x, y] of p.cells) {
      if (y < 0) continue
      const k = `${x},${y}`
      const nv = (acc.get(k) ?? 0) + v
      acc.set(k, nv)
      if (nv > max) max = nv
    }
  }
  if (max > 0) for (const [k, v] of acc) acc.set(k, v / max)
  return acc
}

// ── the loop ─────────────────────────────────────────────────────────────────
function die() {
  if (dead) return
  gen++
  dead = true
  setPhase('over')
  sfx.over()
  if (pieces > 0) remember({ score, lines, pieces, t: Date.now() })
  if (AUTO) setTimeout(start, 5000)
}

async function step() {
  const g = gen
  const stale = () => g !== gen
  const placements = enumeratePlacements(board, current)
  if (placements.length === 0) { die(); return }
  optionCount = placements.length

  while (hidden && !stale()) { setPhase('idle'); await wait(400) }
  if (stale()) return

  setPhase('thinking')
  thinkingSince = performance.now()
  let result
  for (let attempt = 0; ; attempt++) {
    try {
      result = await askForMove(placements)
      if (stale()) return
      netError = null
      break
    } catch (e) {
      netError = e.message || 'could not reach the model'
      if (stale()) return
      if (budgetStop) { setPhase('stalled'); sfx.fail(); return }
      if (attempt >= 4) { setPhase('stalled'); sfx.fail(); return }
      await wait(1200 * (attempt + 1))
      if (stale()) return
      setPhase('thinking')
      thinkingSince = performance.now()
    }
  }

  lastMs = Math.round(performance.now() - thinkingSince)
  lastConf = result.confidence
  chosenId = result.pick?.id ?? null
  chosenShare = result.share ?? 0
  nearMiss = result.margin < 0.05 && !!result.second
  nearMissAt = performance.now()
  runnerUp = nearMiss ? result.second : null
  field = result.field
  cellField = buildCellField(placements, field)
  chosen = result.pick
  sfx.answer(lastConf)
  if (nearMiss) sfx.nearMiss()

  setPhase('field')
  await wait(HOLD)
  if (stale()) return

  dropFrom = gateRow
  setPhase('dropping')
  await wait(150)
  if (stale()) return

  const { board: after, cleared } = applyPlacement(board, chosen, { type: current, conf: lastConf })
  board = after
  lines += cleared
  score += LINE_SCORE[cleared]
  pieces++
  cellField = null; field = null
  cleared ? sfx.clear(cleared) : sfx.lock()

  setPhase('settle')
  await wait(cleared ? 160 : 70)
  if (stale()) return

  current = next
  next = bag()
  return step()
}

function start() {
  started = true
  audioBegin()
  reset()
  step()
}

// How far the piece has fallen while it waits: a row every 320ms, stopping
// short of the stack. The answer arrives and it drops the rest of the way.
function gateRowAt(t) {
  if (!current) return 0
  const m = PIECES[current][0]
  const ox = spawnColumn(current)
  const free = (row) => {
    for (let yy = 0; yy < m.length; yy++) {
      for (let xx = 0; xx < m[yy].length; xx++) {
        if (!m[yy][xx]) continue
        if (row + yy >= ROWS) return false
        if (board?.[row + yy]?.[ox + xx]) return false
      }
    }
    return true
  }
  // Start at the spawn row and only descend into space that is actually empty,
  // so the waiting piece can never be drawn on top of the stack.
  if (!free(0)) return 0
  const wanted = Math.floor(Math.max(0, t - thinkingSince) / 320)
  let r = 0
  for (let cand = 1; cand <= wanted; cand++) {
    if (!free(cand)) break
    r = cand
  }
  return r
}

// ── drawing helpers ──────────────────────────────────────────────────────────
function type(font, px, weight, trackEm) {
  ctx.font = `${weight} ${Math.max(7, px)}px ${font}`
  ctx.letterSpacing = `${(px * (trackEm || 0)).toFixed(2)}px`
}
function put(text, x, y, color, align = 'left', baseline = 'top') {
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = baseline
  ctx.fillText(text, x, y)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
}
function hit(x, y, w, h, action) { hitboxes.push({ x, y, w, h, action }) }
function grillStripe(x, y, w, h) {
  ctx.fillStyle = C.ground
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = C.grill
  for (let i = 1; i < h; i += 2) ctx.fillRect(x, y + i, w, 1)
}

// ── header ───────────────────────────────────────────────────────────────────
// The formula gives Hh = 1.5·d with d the score digit, which leaves no room for
// a second line. The mocks resolve it at 0.385·Hh score over 0.231·Hh sub, so
// those proportions are used and d only sets the header height.
function drawHeader() {
  grillStripe(0, 0, G.W, G.Hh)
  const cx = G.W / 2
  const scoreSize = Math.round(G.Hh * 0.385)
  const subSize = Math.round(G.Hh * 0.231)

  const scoreInk = ready === false ? C.ink0 : !started ? C.ink2 : C.ink4
  type(PS, scoreSize, 400, 0)
  put(String(score).padStart(5, '0'), cx, Math.round(G.Hh * 0.25), scoreInk, 'center')

  if (!minimal()) {
    const bits = []
    if (showLines()) bits.push(`${String(lines).padStart(3, '0')} LINES`)
    if (showBest() && best() > 0) bits.push(`BEST ${String(best()).padStart(5, '0')}`)
    if (bits.length) {
      type(VT, subSize, 400, 0.14)
      put(bits.join(' · '), cx, Math.round(G.Hh * 0.69), ready === false ? C.ink0 : C.ink1, 'center')
    }
  }
}

// ── board ────────────────────────────────────────────────────────────────────
function drawBoardChrome() {
  const t = boardTop()
  ctx.fillStyle = C.board
  ctx.fillRect(0, t, G.W, G.Hb)
  ctx.fillStyle = C.grid
  for (let x = 0; x <= COLS; x++) ctx.fillRect(Math.min(x * G.cell, G.W - 1), t, 1, G.Hb)
  for (let y = 0; y <= ROWS; y++) ctx.fillRect(0, t + y * G.cell, G.W, 1)
  ctx.fillStyle = C.bevel
  ctx.fillRect(0, t, G.W, 1)
}

// A tile, not a rectangle: chamfered light on the top and left, dark on the
// bottom and right, a flat face between them, and a seam so the wall reads as
// something built out of squares. Brightness still carries the confidence.
function block(cx, cy, color, certainty) {
  const k = clamp(0, ((certainty ?? 0.45) - 0.15) / 0.55, 1)
  const b = 0.4 + 0.6 * k
  const s = G.cell
  const x = cx * s
  const y = boardTop() + cy * s
  const e = Math.max(2, Math.round(s * 0.17))   // chamfer

  ctx.fillStyle = shade(color, b * 0.5)          // seam / outer edge
  ctx.fillRect(x, y, s, s)

  ctx.fillStyle = shade(color, b * 1.5)          // top and left catch the light
  ctx.beginPath()
  ctx.moveTo(x + 1, y + 1)
  ctx.lineTo(x + s - 1, y + 1)
  ctx.lineTo(x + s - 1 - e, y + 1 + e)
  ctx.lineTo(x + 1 + e, y + 1 + e)
  ctx.lineTo(x + 1 + e, y + s - 1 - e)
  ctx.lineTo(x + 1, y + s - 1)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = shade(color, b * 0.66)         // bottom and right fall away
  ctx.beginPath()
  ctx.moveTo(x + s - 1, y + 1)
  ctx.lineTo(x + s - 1, y + s - 1)
  ctx.lineTo(x + 1, y + s - 1)
  ctx.lineTo(x + 1 + e, y + s - 1 - e)
  ctx.lineTo(x + s - 1 - e, y + s - 1 - e)
  ctx.lineTo(x + s - 1 - e, y + 1 + e)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = shade(color, b)                // the face
  ctx.fillRect(x + 1 + e, y + 1 + e, s - 2 - e * 2, s - 2 - e * 2)
}
function shade(hex, mul) {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(clamp(0, v * mul, 255)))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
function round(x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawBoard(t) {
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const c = board?.[y]?.[x]
      if (c) block(x, y, PIECE_COLOR[c.type] ?? C.ink2, c.conf)
    }
  }

  // While it is being read about, the piece sits at the top, dim and flat —
  // present but not yet placed. It leaves the moment a placement is chosen.
  if ((phase === 'thinking' || phase === 'idle') && current) {
    const m = PIECES[current][0]
    const ox = spawnColumn(current)
    gateRow = gateRowAt(t)
    for (let yy = 0; yy < m.length; yy++) {
      for (let xx = 0; xx < m[yy].length; xx++) {
        if (m[yy][xx]) block(ox + xx, gateRow + yy, PIECE_COLOR[current] ?? C.ink2, 0.2)
      }
    }
  }

  // the field: every offered way leaves a trace, floor 0.04
  if (phase === 'field' && cellField) {
    for (const [k, p] of cellField) {
      const [x, y] = k.split(',').map(Number)
      ctx.fillStyle = `rgba(200,200,255,${(0.04 + p * 0.09).toFixed(3)})`
      ctx.fillRect(x * G.cell, boardTop() + y * G.cell, G.cell, G.cell)
    }
    // the one it nearly took instead, faded over 600ms
    if (runnerUp) {
      const a = clamp(0, 1 - (t - nearMissAt) / 600, 1) * 0.55
      if (a > 0.01) {
        ctx.save()
        ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`
        ctx.lineWidth = 1
        ctx.setLineDash([2, 2])
        for (const [x, y] of runnerUp.cells) {
          if (y < 0) continue
          round(x * G.cell + 0.5, boardTop() + y * G.cell + 0.5, G.cell - 1, G.cell - 1, 3)
          ctx.stroke()
        }
        ctx.restore()
      }
    }
    // the placement it took: solid, ringed
    if (chosen) {
      const col = PIECE_COLOR[current] ?? C.ink2
      for (const [x, y] of chosen.cells) {
        if (y < 0) continue
        block(x, y, col, 0.9)
      }
      ctx.save()
      ctx.strokeStyle = C.ink6
      ctx.lineWidth = 2
      ctx.shadowColor = 'rgba(255,255,255,0.5)'
      ctx.shadowBlur = 16
      for (const [x, y] of chosen.cells) {
        if (y < 0) continue
        round(x * G.cell + 1, boardTop() + y * G.cell + 1, G.cell - 2, G.cell - 2, 3)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  if (phase === 'dropping' && chosen) {
    const k = clamp(0, (t - phaseStart) / 150, 1)
    const e = 1 - Math.pow(1 - k, 3)
    const topY = Math.min(...chosen.cells.map(([, cy]) => cy))
    const dy = (topY - dropFrom) * (1 - e)
    for (const [cx, cy] of chosen.cells) {
      const y = cy - dy
      if (y < -0.9) continue
      block(cx, y, PIECE_COLOR[current] ?? C.ink2, lastConf)
    }
  }
}

// START: the identical rect on attract and on game over
function startRect() {
  const w = Math.round(5.56 * G.cell)
  const h = Math.round(1.33 * G.cell)
  return { x: Math.round((G.W - w) / 2), y: Math.round(boardTop() + 9.4 * G.cell), w, h }
}
function drawStart() {
  const r = startRect()
  const on = hovered === 'start'
  const size = Math.round(0.556 * G.cell)
  type(PS, size, 400, 0)
  put('START', r.x + r.w / 2, r.y + r.h / 2, C.ink6, 'center', 'middle')
  if (on) {
    const w = ctx.measureText('START').width
    const gap = Math.round(size * 0.85)
    const a = Math.round(size * 0.42)                 // half-height
    const cy = Math.round(r.y + r.h / 2)              // the face's optical centre
    ctx.fillStyle = C.jev
    const tri = (tipX, dir) => {
      ctx.beginPath()
      ctx.moveTo(tipX, cy)
      ctx.lineTo(tipX - dir * a, cy - a)
      ctx.lineTo(tipX - dir * a, cy + a)
      ctx.closePath()
      ctx.fill()
    }
    tri(Math.round(r.x + r.w / 2 - w / 2 - gap), 1)
    tri(Math.round(r.x + r.w / 2 + w / 2 + gap), -1)
  }
  hit(r.x, r.y, r.w, r.h, 'start')
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(12,12,12,0.76)'
  ctx.fillRect(0, boardTop(), G.W, G.Hb)
  const size = Math.round(0.667 * G.cell)
  type(PS, size, 400, 0)
  const y = Math.round(boardTop() + 5.56 * G.cell)
  put('HEY JEV,', G.W / 2, y, C.jev, 'center')
  put('YOU LOST', G.W / 2, y + Math.round(size * 1.6), C.jev, 'center')
  drawStart()
}

function drawNoKey() {
  type(PS, Math.round(0.389 * G.cell), 400, 0)
  put('NO JEV API KEY', G.W / 2, Math.round(boardTop() + 1.44 * G.cell), C.ink2, 'center')
}

// ── the strip: identical grid in every state ─────────────────────────────────
function stripCopy() {
  const pre = !started || ready === false
  if (pre) return { l: 'CODE FINDS', r: 'JEV PICKS', rInk: C.jev, hl: 'ALL WAYS', hr: 'ONE', hrInk: C.jev }
  if (phase === 'stalled' && budgetStop) {
    return { l: 'CODE FOUND', r: 'NO BUDGET', rInk: C.ink2, hl: ways(), hr: 'ADD CREDITS', hrInk: C.jev }
  }
  if (phase === 'stalled') {
    return { l: 'CODE FOUND', r: 'NO ANSWER', rInk: C.red, hl: ways(), hr: 'NOTHING', hrInk: C.ink1 }
  }
  if (phase === 'thinking' || phase === 'idle') {
    return { l: 'CODE FOUND', r: 'JEV IS READING', rInk: C.jev, hl: ways(), hr: '·  ·  ·', hrInk: C.jev, blink: true }
  }
  const label = nearMiss ? "JEV ALMOST DIDN'T" : 'JEV PICKED'
  return { l: 'CODE FOUND', r: label, rInk: dead ? C.jevDim : C.jev, hl: ways(), hr: picked(), hrInk: dead ? C.jevDim : C.jev }
}
const ways = () => `${String(optionCount).padStart(2, '0')} WAYS`
const picked = () => {
  const n = chosenId ? Number(chosenId.slice(1)) + 1 : 0
  return `#${n} · ${String(Math.round(chosenShare * 100)).padStart(2, '0')}%`
}

function drawStrip(t) {
  const y0 = stripTop()
  const sv = G.sv
  const p = pad()
  const L = p
  const R = G.W - p
  grillStripe(0, y0, G.W, G.Hs)

  // bevel, or the one red thing in the piece
  if (phase === 'stalled' && !budgetStop) {
    ctx.fillStyle = C.red
    for (let x = 0; x < G.W; x += 10) ctx.fillRect(x, y0, 5, 2)
  } else if (phase === 'stalled') {
    ctx.fillStyle = C.ink0
    for (let x = 0; x < G.W; x += 10) ctx.fillRect(x, y0, 5, 2)
  } else {
    ctx.fillStyle = C.bevel
    ctx.fillRect(0, y0, G.W, 1)
  }

  const s = stripCopy()

  if (!minimal()) {
    type(VT, labelSize(), 400, labelTrack())
    put(s.l, L, y0 + 0.46 * sv, dead ? C.ink0 : C.ink1)
    put(s.r, R, y0 + 0.46 * sv, s.rInk, 'right')
  }

  // Each hero owns half the strip and never crosses the middle. Press Start 2P
  // is a full-width face, so the pair is sized down together — together, so the
  // two never disagree about how important they are.
  type(PS, G.hero, 400, 0)
  const hy = y0 + 1.15 * sv
  put(s.hl, L, hy, dead ? C.ink2 : C.ink5)
  const blinkOn = !s.blink || Math.floor(t / 550) % 2 === 0
  put(s.hr, R, hy, blinkOn ? s.hrInk : C.ink0, 'right')

  const costText = `$${(meta?.usd ?? 0).toFixed(3)}`
  if (!minimal() && !tight()) {
    type(VT, 0.54 * sv, 400, 0.1)
    put(costText, R, y0 + 2.73 * sv, C.ink2, 'right')
  }

  // HOW IT WORKS — the only labelled control, 44px hit band
  {
    const size = 0.5 * sv
    type(VT, size, 400, 0.12)
    const hy = y0 + G.Hs - 27
    const lit = showPanel || hovered === 'help'
    put('HOW IT WORKS', L, hy, lit ? C.jev : C.ink2)
    const w = ctx.measureText('HOW IT WORKS').width
    ctx.fillStyle = lit ? C.jev : C.ink0
    if (lit) ctx.fillRect(L, hy + size + 3, w, 1)
    else for (let x = 0; x < w; x += 3) ctx.fillRect(L + x, hy + size + 3, 1, 1)
    hit(L - 6, hy + size / 2 - 22, w + 12, 44, 'help')
  }

  // MS, or the recovery in its slot
  const my = y0 + G.Hs - 26
  type(VT, 0.54 * sv, 400, phase === 'stalled' ? 0.12 : 0.1)
  if (phase === 'stalled') {
    const ink = hovered === 'retry' ? C.ink6 : budgetStop ? C.ink1 : C.hot
    put('TRY AGAIN ▸', R, my, ink, 'right')
    const w = ctx.measureText('TRY AGAIN ▸').width
    hit(R - w - 6, my - 12, w + 12, 44, 'retry')
  } else {
    const thinking = phase === 'thinking'
    const ms = thinking ? Math.round(t - thinkingSince) : lastMs
    put(`${String(ms).padStart(4, '0')}MS`, R, my, dead ? C.ink0 : thinking ? C.hot : C.ink1, 'right')
  }

  if (minimal() || !tight()) return
  // TIGHT: cost joins the bottom row, left of MS
  type(VT, 0.54 * sv, 400, 0.1)
  put(costText, R - Math.round(4.6 * sv), my, C.ink2, 'right')
}

// ── the one panel ────────────────────────────────────────────────────────────
const PANEL = [
  ['', 'The code finds every way the piece can be manoeuvred into a resting place and writes each one out as an English sentence. JEV reads the sentences and points at one. It never sees the board, or a single number.'],
  ['THE GLOW', 'how much of its wanting rests on each cell. Brighter = more of the field agrees.'],
  ['WHITE RING', 'the placement it took.'],
  ['DOTTED RING', 'the one it nearly took instead. About one move in eight.'],
  ['#N · N%', "which way it took, numbered left to right, and that way's share of the field. 80% knew; 20% is a coin toss between look-alikes."],
  ['DIM BLOCKS', 'how sure it was when it placed them. The wall is a record of its doubt.'],
  ['MS', 'how long the model took. The piece falls a row at a time while it reads, then drops the rest of the way the moment the answer lands. This is the tempo.'],
  ['$', 'what the session has cost so far, in real money.'],
]

function wrap(text, maxW) {
  const out = []
  let line = ''
  for (const word of text.split(' ')) {
    const nx = line ? `${line} ${word}` : word
    if (ctx.measureText(nx).width > maxW && line) { out.push(line); line = word }
    else line = nx
  }
  if (line) out.push(line)
  return out
}

function drawPanel() {
  const t = boardTop()
  const p = pad()
  const k = G.cell / 36
  const sz = (v) => Math.max(13, Math.round(v * k))

  ctx.fillStyle = C.sheet
  ctx.fillRect(0, t, G.W, G.Hb)

  type(VT, sz(15), 400, 0.2)
  put('WHAT YOU ARE LOOKING AT', p, t + Math.round(18 * k), C.ink4)
  type(VT, sz(18), 400, 0)
  put('×', G.W - p, t + Math.round(16 * k), hovered === 'close' ? C.ink4 : C.ink1, 'right')
  hit(G.W - p - 34, t + Math.round(16 * k) - 8, 44, 44, 'close')

  ctx.fillStyle = '#2f2f2f'
  ctx.fillRect(p, t + Math.round(42 * k), G.W - 2 * p, 1)

  let y = t + Math.round(58 * k)
  const gutter = Math.max(72, Math.round(96 * k))
  const bodyW = G.W - 2 * p

  for (const [key, text] of PANEL) {
    if (!key) {
      type(VT, sz(15), 400, 0)
      const lh = sz(15) * 1.55
      for (const line of wrap(text, bodyW)) { put(line, p, y, C.ink4); y += lh }
      y += sz(15) * 0.6
      continue
    }
    type(VT, sz(13), 400, 0.1)
    put(key, p, y, C.jev)
    type(VT, sz(13.5), 400, 0)
    const lh = sz(13.5) * 1.5
    let yy = y
    for (const line of wrap(text, bodyW - gutter)) { put(line, p + gutter, yy, C.ink3); yy += lh }
    y = Math.max(yy, y + lh) + sz(13.5) * 0.45
  }

  const footRule = t + G.Hb - Math.round(42 * k)
  ctx.fillStyle = '#2f2f2f'
  ctx.fillRect(p, footRule, G.W - 2 * p, 1)
  type(VT, sz(13), 400, 0.08)
  put(`${(meta?.model ?? 'JEV').toUpperCase()} · WEIGHTS OURS, PROBABILITIES ITS`, p, footRule + Math.round(14 * k), C.ink1)
}

// ── CRT ──────────────────────────────────────────────────────────────────────
function makeGrill() {
  const c = document.createElement('canvas')
  c.width = 1
  c.height = 3 * dpr
  const g = c.getContext('2d')
  g.fillStyle = 'rgba(0,0,0,0.10)'
  g.fillRect(0, 0, 1, dpr)
  return view.createPattern(c, 'repeat')
}

function compose() {
  view.setTransform(1, 0, 0, 1, 0, 0)
  view.clearRect(0, 0, canvas.width, canvas.height)

  // 2 · sharp, then a halo of itself
  view.drawImage(buf, 0, 0)
  view.save()
  view.filter = 'blur(4px)'
  view.globalCompositeOperation = 'lighter'
  view.globalAlpha = 0.18
  view.drawImage(buf, 0, 0)
  view.restore()

  // 3 · grill
  if (!grillPattern) grillPattern = makeGrill()
  view.fillStyle = grillPattern
  view.fillRect(0, 0, canvas.width, canvas.height)

  view.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function vignette() {
  view.setTransform(dpr, 0, 0, dpr, 0, 0)
  const g = view.createRadialGradient(G.W / 2, G.H * 0.48, 0, G.W / 2, G.H * 0.48, Math.max(G.W, G.H) * 0.62)
  g.addColorStop(0.66, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(0,0,0,0.18)')
  view.fillStyle = g
  view.fillRect(0, 0, G.W, G.H)
}

// ── frame ────────────────────────────────────────────────────────────────────
function render(t) {
  requestAnimationFrame(render)
  if (!fontsReady) return
  hitboxes = []

  // 1 · everything that may bloom, into the buffer
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, G.W, G.H)
  ctx.fillStyle = C.ground
  ctx.fillRect(0, 0, G.W, G.H)

  drawHeader()
  drawBoardChrome()
  if (started && !showPanel) drawBoard(t)
  if (showPanel) drawPanel()
  else if (ready === false) drawNoKey()
  else if (dead) drawGameOver()
  else if (!started) drawStart()

  drawStrip(t)

  compose()
  vignette()
}

// ── input ────────────────────────────────────────────────────────────────────
const toCanvas = (e) => {
  const r = canvas.getBoundingClientRect()
  return { x: (e.clientX - r.left) * (G.W / r.width), y: (e.clientY - r.top) * (G.H / r.height) }
}
const at = (pt) => hitboxes.find((b) => pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h)

canvas.addEventListener('mousemove', (e) => {
  pointer = true
  const h = at(toCanvas(e))
  hovered = h ? h.action : null
  document.documentElement.style.cursor = h ? CURSOR_LIVE : CURSOR_IDLE
})
canvas.addEventListener('mouseleave', () => { hovered = null; document.documentElement.style.cursor = CURSOR_IDLE })

canvas.addEventListener('click', (e) => {
  const h = at(toCanvas(e))
  if (!h) return                       // tapping the board does nothing
  sfx.press()
  if (h.action === 'start') { showPanel = false; start() }
  if (h.action === 'help') showPanel = !showPanel
  if (h.action === 'close') showPanel = false
  if (h.action === 'retry') { netError = null; if (!dead) step() }
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') showPanel = false
  if (e.key === 'm' || e.key === 'M') toggleMute()
  if ((e.key === 'Enter' || e.key === ' ') && ready && (!started || dead)) { e.preventDefault(); start() }
})
document.addEventListener('visibilitychange', () => { hidden = document.hidden })

// ── server handshake ─────────────────────────────────────────────────────────
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

// ── test hooks ───────────────────────────────────────────────────────────────
window.__test = {
  die: () => die(),
  forceNearMiss: () => { nearMiss = true; nearMissAt = performance.now(); runnerUp = runnerUp || chosen },
  state: () => ({
    phase, dead, started, pieces, score, lines, netError, showPanel,
    history: history.length, cell: G.cell, well: G.W, header: G.Hh, strip: G.Hs,
    boardTop: boardTop(), stripTop: stripTop(), canvas: [G.W, G.H],
  }),
}
window.__ui = { help: (v) => { showPanel = v } }
window.__hit = () => hitboxes.map((b) => ({ ...b }))
window.__click = (action) => {
  const b = hitboxes.find((x) => x.action === action)
  if (!b) return `no such control: ${action}`
  const r = canvas.getBoundingClientRect()
  canvas.dispatchEvent(new MouseEvent('click', {
    clientX: r.left + (b.x + b.w / 2) * (r.width / G.W),
    clientY: r.top + (b.y + b.h / 2) * (r.height / G.H),
    bubbles: true,
  }))
  return `clicked ${action}`
}

// ── go ───────────────────────────────────────────────────────────────────────
blank()
layout()
requestAnimationFrame(render)

// Both fonts before first paint, so no metrics change under the layout. They
// come over the network though, and a blank screen is worse than a late font:
// paint anyway after 2.5s and let the reflow happen.
const loaded = Promise.all(['16px "Press Start 2P"', '16px "VT323"'].map((f) => document.fonts.load(f)))
  .then(() => document.fonts.ready)
  .catch(() => {})
Promise.race([loaded, new Promise((r) => setTimeout(r, 2500))]).then(() => {
  fontsReady = true
  layout()
  if (AUTO) checkServer().then(() => { if (ready) start() })
})
loaded.then(() => layout())

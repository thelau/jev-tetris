// Eight-bit voice, written rather than sampled — no files, no dependencies.
// Square and triangle oscillators through a hard gain envelope, which is what
// a 1980s sound chip actually was.
//
// It stays quiet on purpose. The piece is a machine thinking, not a game.
// Nothing here is on screen: the browser will not allow sound before a gesture,
// so it wakes on START. M mutes.

let ctx = null
let master = null
let musicGain = null
let sfxGain = null
let started = false
let muted = false
let step = 0
let timer = null

const MASTER = 0.22        // discreet. this is the whole volume policy
const TEMPO = 132          // bpm, four steps to the beat

function ensure() {
  if (ctx) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = muted ? 0 : MASTER
  master.connect(ctx.destination)
  musicGain = ctx.createGain()
  musicGain.gain.value = 0.55
  musicGain.connect(master)
  sfxGain = ctx.createGain()
  sfxGain.gain.value = 1
  sfxGain.connect(master)
  return ctx
}

// one chip voice: a shape, a pitch, a length, a level
function blip({ freq, dur = 0.08, type = 'square', level = 0.3, to = null, dest = null, delay = 0 }) {
  if (!ctx) return
  const t = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur)
  // hard attack, exponential tail — no easing, chips did not ease
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(level, t + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g)
  g.connect(dest || sfxGain)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

function noise({ dur = 0.09, level = 0.18, delay = 0 }) {
  if (!ctx) return
  const t = ctx.currentTime + delay
  const n = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n)
  const src = ctx.createBufferSource()
  src.buffer = buf
  const g = ctx.createGain()
  g.gain.value = level
  const f = ctx.createBiquadFilter()
  f.type = 'highpass'
  f.frequency.value = 1400
  src.connect(f); f.connect(g); g.connect(sfxGain)
  src.start(t)
}

// ── the bed ──────────────────────────────────────────────────────────────────
// Sixteen steps of minimal techno in A minor: a kick on the quarters, a closed
// hat on the offs, and a two-bar bass figure. No melody — a melody would start
// competing with the game for attention, and the game is the point.
const BASS = [55, 0, 0, 0, 55, 0, 82.41, 0, 65.41, 0, 0, 0, 55, 0, 49, 0]
const STAB = [0, 0, 220, 0, 0, 0, 0, 0, 0, 0, 261.63, 0, 0, 0, 0, 196]

function tick() {
  if (!ctx || muted) return
  const i = step % 16

  if (i % 4 === 0) {
    blip({ freq: 110, to: 40, dur: 0.11, type: 'triangle', level: 0.5, dest: musicGain })
  }
  if (i % 4 === 2) noise({ dur: 0.022, level: 0.05 })
  if (BASS[i]) {
    blip({ freq: BASS[i], dur: 0.16, type: 'square', level: 0.16, dest: musicGain })
  }
  if (STAB[i] && step % 64 >= 32) {
    blip({ freq: STAB[i], dur: 0.1, type: 'square', level: 0.05, dest: musicGain })
  }
  step++
}

export function begin() {
  const c = ensure()
  if (!c) return
  if (c.state === 'suspended') c.resume()
  if (started) return
  started = true
  timer = setInterval(tick, (60 / TEMPO / 4) * 1000)
}

export function stop() {
  if (timer) clearInterval(timer)
  timer = null
  started = false
}

export function toggleMute() {
  muted = !muted
  if (master) master.gain.value = muted ? 0 : MASTER
  return muted
}

// ── events ───────────────────────────────────────────────────────────────────
// One sound per thing that actually happens. Nothing decorative.
export const sfx = {
  // the call goes out: a short rising query
  ask: () => blip({ freq: 480, to: 760, dur: 0.05, level: 0.07 }),
  // the answer lands: two notes, the second brighter the surer it was
  answer: (conf = 0.4) => {
    blip({ freq: 620, dur: 0.045, level: 0.09 })
    blip({ freq: 700 + conf * 500, dur: 0.06, level: 0.08, delay: 0.05 })
  },
  // the piece locks
  lock: () => { blip({ freq: 150, to: 90, dur: 0.07, type: 'square', level: 0.2 }); noise({ dur: 0.04, level: 0.09 }) },
  // rows clear: one rising note per row
  clear: (rows = 1) => {
    for (let i = 0; i < rows; i++) {
      blip({ freq: 520 + i * 180, dur: 0.1, type: 'square', level: 0.18, delay: i * 0.06 })
    }
    if (rows === 4) blip({ freq: 1320, dur: 0.3, type: 'triangle', level: 0.14, delay: 0.26 })
  },
  // it nearly chose something else
  nearMiss: () => blip({ freq: 990, to: 880, dur: 0.07, type: 'triangle', level: 0.09 }),
  // a control was pressed
  press: () => blip({ freq: 880, dur: 0.035, level: 0.14 }),
  // the call failed
  fail: () => { blip({ freq: 240, to: 150, dur: 0.18, type: 'square', level: 0.14 }); blip({ freq: 180, to: 110, dur: 0.22, type: 'square', level: 0.1, delay: 0.1 }) },
  // it lost
  over: () => {
    const fall = [440, 349.23, 293.66, 220]
    fall.forEach((f, i) => blip({ freq: f, dur: 0.34, type: 'square', level: 0.16, delay: i * 0.17 }))
  },
}

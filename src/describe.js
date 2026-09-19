// Turns geometry into words. This file is the whole bet:
// the model cannot count, so it never sees a number — only a described outcome.
// Every option uses the identical sentence template, because equivalent
// wordings are not guaranteed to produce equivalent judgements.

import { COLS, ROWS, PIECES, columnHeights, countHoles, holesByColumn, deepestWell, evaluate } from './tetris.js'

const PLACE = [
  'the far left', 'the left', 'left of centre', 'just left of centre', 'the centre',
  'the centre', 'just right of centre', 'right of centre', 'the right', 'the far right',
]

const REGION = (x) => (x <= 2 ? 'the left' : x <= 6 ? 'the middle' : 'the right')

const PIECE_NAMES = {
  I: 'the long bar', O: 'the square', T: 'the T', S: 'the S zigzag',
  Z: 'the Z zigzag', J: 'the J hook', L: 'the L hook',
}

function band(h) {
  if (h === 0) return 'empty'
  if (h <= 3) return 'low'
  if (h <= 7) return 'medium'
  if (h <= 11) return 'high'
  return 'very high'
}

function orientation(type, rot) {
  const m = PIECES[type][rot]
  const w = m[0].length
  const h = m.length
  if (w > h) return 'lying flat'
  if (h > w) return 'standing upright'
  return 'square on'
}

function where(placement) {
  const xs = placement.cells.map(([x]) => x)
  const mid = Math.round((Math.min(...xs) + Math.max(...xs)) / 2)
  return PLACE[Math.max(0, Math.min(COLS - 1, mid))]
}

function linesPhrase(n) {
  return ['Clears no lines', 'Clears one line', 'Clears two lines', 'Clears three lines', 'Clears four lines at once'][n] || 'Clears four lines at once'
}

function holesPhrase(n) {
  if (n === 0) return 'Traps no new space underneath'
  if (n === 1) return 'Traps one new pocket of space underneath, for good'
  if (n === 2) return 'Traps two new pockets of space underneath, for good'
  if (n === 3) return 'Traps three new pockets of space underneath, for good'
  return 'Traps four or more new pockets of space underneath, for good'
}

// The death-spiral fix: say out loud when a move is stacking on its own mess.
// Speaks only about space that was ALREADY trapped. It used to also claim the
// move rested on solid ground, which contradicted the previous sentence whenever
// the move itself trapped something — and this model reads literally.
function sealPhrase(ev) {
  if (ev.freed > 0) return 'It also frees space that was trapped before, opening it up again.'
  if (ev.sealsExisting === 0) return ''
  if (ev.sealsExisting <= 2) return 'It piles on top of space that was already trapped, pushing it further out of reach.'
  return 'It piles on top of a great deal of already-trapped space, putting it far out of reach.'
}

function surfacePhrase(delta) {
  if (delta <= -3) return 'Flattens the surface out'
  if (delta <= -1) return 'Tidies the surface slightly'
  if (delta <= 1) return 'Leaves the surface much as it was'
  if (delta <= 4) return 'Leaves a step in the surface'
  return 'Leaves a jagged edge behind'
}

function heightPhrase(maxHeight) {
  if (maxHeight <= 4) return 'The stack stays low'
  if (maxHeight <= 7) return 'The stack reaches a third of the way up'
  if (maxHeight <= 10) return 'The stack reaches halfway up'
  if (maxHeight <= 13) return 'The stack is well above halfway'
  if (maxHeight <= 16) return 'The stack is getting dangerously tall'
  return 'The stack is nearly at the top'
}

function wellPhrase(ev) {
  const filled = ev.wellBefore.depth >= 3 && ev.well.depth < ev.wellBefore.depth
  const dug = ev.well.depth >= 4 && ev.well.depth > ev.wellBefore.depth
  if (filled) return ' It fills the deep notch.'
  if (dug) return ' It opens a deep narrow notch that only the long bar can fill.'
  if (ev.well.depth >= 4) return ' The deep narrow notch is left open.'
  return ''
}

function list(items) {
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// One board, described as a shape rather than as numbers.
export function describeBoard(board, current, next) {
  const heights = columnHeights(board)
  const per = holesByColumn(board)
  const max = Math.max(...heights)
  const holes = per.reduce((a, b) => a + b, 0)
  const well = deepestWell(heights)
  const left = heights.slice(0, 5).reduce((a, b) => a + b, 0)
  const right = heights.slice(5).reduce((a, b) => a + b, 0)

  let lean = 'It is roughly level across.'
  if (left - right > 8) lean = 'It leans heavy on the left and is lower on the right.'
  else if (right - left > 8) lean = 'It leans heavy on the right and is lower on the left.'

  const min = Math.min(...heights)
  const tallest = heights.indexOf(max)
  const lowest = heights.indexOf(min)
  const flat = max === min

  // Where the mess actually is, so it can be dug out rather than built on.
  let buried
  if (holes === 0) {
    buried = 'Nothing is trapped underneath. Every empty square can still be reached from above.'
  } else {
    const regions = [...new Set(per.map((n, x) => (n > 0 ? REGION(x) : null)).filter(Boolean))]
    const worst = per.indexOf(Math.max(...per))
    const clean = per.map((n, x) => (n === 0 && heights[x] > 0 ? PLACE[x] : null)).filter(Boolean)
    buried =
      `${holes === 1 ? 'One pocket of space is' : holes <= 4 ? 'A few pockets of space are' : 'Many pockets of space are'} ` +
      `trapped under the blocks, in ${list(regions)}. The worst of it is at ${PLACE[worst]}, ` +
      `where blocks sit on top of empty squares that can no longer be reached. ` +
      (clean.length ? `The columns at ${list(clean.slice(0, 4))} are still clean underneath.` : 'Almost nothing is clean underneath.')
  }

  const room = max <= 8 ? 'There is plenty of room above.'
    : max <= 13 ? 'Room above is getting tight.'
    : max <= 16 ? 'There is little room left above.'
    : 'There is almost no room left. The next bad placement ends it.'

  const wellText = well.depth >= 4
    ? ` A deep narrow notch sits at ${PLACE[well.x]}, and only the long bar will fill it.`
    : ''

  return {
    shape: flat
      ? `${max === 0 ? 'The well is empty.' : 'The surface is completely level across.'}${wellText}`
      : `${lean} The tallest point is at ${PLACE[tallest]}; the lowest is at ${PLACE[lowest]}.${wellText}`,
    surface: `Left to right the surface sits: ${heights.map(band).join(', ')}.`,
    buried,
    room,
    piece: `The piece to place now is ${PIECE_NAMES[current]}.`,
    next: next ? `The piece after this one is ${PIECE_NAMES[next]}.` : undefined,
  }
}

// One sentence per candidate, all built from the same template so they compare.
// Consequence first, position last — the position is the least important fact.
export function describePlacements(board, placements) {
  const criteria = {}
  const evaluated = []
  for (const p of placements) {
    const ev = evaluate(board, p)
    evaluated.push({ placement: p, ev })
    criteria[p.id] = [
      `${holesPhrase(ev.holesCreated)}.`,
      sealPhrase(ev),   // may be empty; filtered below
      `${linesPhrase(ev.cleared)}.`,
      `${surfacePhrase(ev.bumpinessDelta)}.`,
      `${heightPhrase(ev.maxHeight)}.${wellPhrase(ev)}`,
      `It goes at ${where(p)}, ${orientation(p.type, p.rot)}.`,
    ].filter(Boolean).join(' ')
  }
  return { criteria, evaluated }
}

// Composite scoring. One judgement per question, weighted in our own code —
// a dial we control instead of one opaque verdict. Every question is evaluated
// in parallel, so five of them cost tokens and almost no extra latency.
// Weights are fitted, not guessed: see `node spike/play.js --mode composite`,
// which scores every voice on its own. Judged alone over 60 turns, `sealed`
// buried one hole and `flat` buried 138 — so they are not worth the same vote.
// All five are still asked, because the piece renders all five fields.
export const VOICES = {
  sealed: { weight: 0.55, instructions: 'Which option traps the least empty space underneath the blocks' },
  clears: { weight: 0.22, instructions: 'Which option removes the most complete rows' },
  unburied: { weight: 0.15, instructions: 'Which option does most to keep already-trapped space reachable, rather than piling more on top of it' },
  low: { weight: 0.05, instructions: 'Which option keeps the stack furthest away from the top' },
  flat: { weight: 0.03, instructions: 'Which option leaves the most even and level surface' },
}

const AMBIENT = {
  danger: {
    type: 'score',
    instructions: 'How much trouble is this board in',
    criteria: ['Safe and tidy, plenty of room', 'Workable but untidy', 'Struggling, gaps and height building', 'About to lose'],
  },
  doomed: {
    type: 'noul',
    instructions: 'This board cannot be recovered and will top out soon',
  },
}

export function buildQuestions(criteria, mode = 'composite') {
  if (mode === 'single') {
    return {
      move: {
        type: 'choice',
        instructions: 'Choose the best place to put this piece. Survival matters more than clearing lines: avoid burying gaps, keep the surface even, keep the stack low.',
        criteria,
      },
      ...AMBIENT,
    }
  }
  const qs = {}
  for (const [name, v] of Object.entries(VOICES)) {
    qs[name] = { type: 'choice', instructions: v.instructions, criteria }
  }
  return { ...qs, ...AMBIENT }
}

// Blend the voices into one field. The weights are ours; the judgements are its.
//
// 'sum' is a vote: four mild approvals outvote one strong objection, which is
// how it kept burying space that the sealed voice had flagged. 'product' is a
// weighted geometric mean, so a voice that gives an option near zero vetoes it
// however much the others like it. Still the model's judgement — combined with
// AND instead of OR.
const EPS = 0.01

export function blend(distributions, ids, mode = 'sum', weights = null) {
  const field = Object.fromEntries(ids.map((id) => [id, mode === 'product' ? 1 : 0]))
  for (const [name, probs] of Object.entries(distributions)) {
    const w = weights ? weights[name] : VOICES[name]?.weight
    if (!w || !probs) continue
    for (const id of ids) {
      const p = probs[id] ?? 0
      if (mode === 'product') field[id] *= Math.pow(p + EPS, w)
      else field[id] += w * p
    }
  }
  const total = Object.values(field).reduce((a, b) => a + b, 0) || 1
  for (const id of ids) field[id] /= total
  return field
}

export { ROWS, COLS }

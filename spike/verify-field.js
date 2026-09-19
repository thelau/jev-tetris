// Is every glowing cell actually a legal place the piece could land?
// Rebuilds the field exactly as the renderer does and audits it.

import { COLS, ROWS, emptyBoard, enumeratePlacements, applyPlacement, makeBag } from '../src/tetris.js'
import { heuristicPick } from '../src/heuristic.js'

const bag = makeBag(11)
let board = emptyBoard()
for (let i = 0; i < 45; i++) {
  const t = bag()
  const ps = enumeratePlacements(board, t)
  if (!ps.length) break
  board = applyPlacement(board, heuristicPick(board, ps), { type: t, conf: 0.5 }).board
}

const piece = 'L'
const placements = enumeratePlacements(board, piece)

// pretend a plausible sparse distribution, same shape the API returns
const probs = {}
placements.forEach((p, i) => { probs[p.id] = i < 6 ? [0.42, 0.21, 0.13, 0.09, 0.04, 0.01][i] : 0 })

const acc = new Map()
for (const p of placements) {
  const v = probs[p.id] ?? 0
  if (v <= 0) continue
  for (const [x, y] of p.cells) {
    if (y < 0) continue
    acc.set(`${x},${y}`, (acc.get(`${x},${y}`) ?? 0) + v)
  }
}

let onOccupied = 0
let orphan = 0
for (const k of acc.keys()) {
  const [x, y] = k.split(',').map(Number)
  if (board[y][x]) onOccupied++
  if (!placements.some((p) => probs[p.id] > 0 && p.cells.some(([cx, cy]) => cx === x && cy === y))) orphan++
}

console.log(`piece ${piece}: ${placements.length} legal placements, ${acc.size} cells lit`)
console.log(`cells lit on top of an occupied square : ${onOccupied}`)
console.log(`cells lit belonging to no placement    : ${orphan}`)

// how much of the lit area any single placement can account for
const best = Math.max(...placements.filter((p) => probs[p.id] > 0).map((p) => p.cells.length))
console.log(`largest single placement               : ${best} cells (of ${acc.size} lit)`)
console.log(`so the lit shape is a union of ${placements.filter((p) => probs[p.id] > 0).length} different placements\n`)

const render = []
for (let y = 0; y < ROWS; y++) {
  let row = ''
  for (let x = 0; x < COLS; x++) {
    const v = acc.get(`${x},${y}`)
    row += board[y][x] ? '#' : v ? (v > 0.2 ? 'O' : v > 0.05 ? 'o' : '.') : ' '
  }
  render.push(row)
}
console.log('  # settled   O/o/. field by strength\n')
console.log(render.map((r, i) => `  ${String(i).padStart(2)} |${r}|`).join('\n'))

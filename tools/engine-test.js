// The game itself, with no model and no browser involved. Every invariant the
// board must never break, plus a long played-out game checked move by move.
//
//   node tools/engine-test.js

import {
  COLS, ROWS, PIECES, PIECE_TYPES, emptyBoard, enumeratePlacements, enumerateDrops,
  applyPlacement, columnHeights, countHoles, holesByColumn, makeBag, spawnBlocked,
  spawnColumn, evaluate, LINE_SCORE,
} from '../src/tetris.js'
import { heuristicPick } from '../src/heuristic.js'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`)
  ok ? passed++ : failed++
}
const filled = (b) => b.flat().filter(Boolean).length
const occupied = (b, x, y) => y >= 0 && y < ROWS && x >= 0 && x < COLS && !!b[y][x]

console.log('\nshapes')
check('rotation counts are right',
  PIECES.O.length === 1 && PIECES.I.length === 2 && PIECES.S.length === 2 &&
  PIECES.Z.length === 2 && PIECES.T.length === 4 && PIECES.J.length === 4 && PIECES.L.length === 4)
check('every piece is four cells',
  PIECE_TYPES.every((p) => PIECES[p].every((m) => m.flat().filter(Boolean).length === 4)))

console.log('\nplacements on a clear board')
{
  const b = emptyBoard()
  let allIn = true, allSupported = true, allClear = true, allFour = true
  const seen = new Set()
  let dupes = 0
  for (const p of PIECE_TYPES) {
    for (const pl of enumeratePlacements(b, p)) {
      if (pl.cells.length !== 4) allFour = false
      for (const [x, y] of pl.cells) {
        if (x < 0 || x >= COLS || y < 0 || y >= ROWS) allIn = false
        if (occupied(b, x, y)) allClear = false
      }
      // resting: one row lower must be blocked by the floor or a block
      const canFall = pl.cells.every(([x, y]) => y + 1 < ROWS && !occupied(b, x, y + 1))
      if (canFall) allSupported = false
      const key = p + pl.cells.map((c) => c.join(',')).sort().join('|')
      if (seen.has(key)) dupes++
      seen.add(key)
    }
  }
  check('every placement is four cells', allFour)
  check('every placement is inside the field', allIn)
  check('no placement overlaps an existing block', allClear)
  check('every placement is resting on something', allSupported)
  check('no duplicate placements', dupes === 0, `${dupes} duplicates`)
}

console.log('\nlines')
{
  const b = emptyBoard()
  for (let x = 0; x < COLS - 1; x++) b[ROWS - 1][x] = 1
  b[ROWS - 3][0] = 1                                   // a marker that must fall
  const one = applyPlacement(b, { cells: [[COLS - 1, ROWS - 1]] }, 1)
  check('a full row clears', one.cleared === 1)
  check('the row above falls by one', one.board[ROWS - 2][0] === 1 && !one.board[ROWS - 3][0])
  check('the cleared row is gone', one.board[ROWS - 1].every((c) => !c))
  check('a top row appears', one.board[0].every((c) => !c))
}
{
  const b = emptyBoard()
  for (let y = ROWS - 4; y < ROWS; y++) for (let x = 0; x < COLS - 1; x++) b[y][x] = 1
  const four = applyPlacement(b, { cells: [[9, ROWS - 4], [9, ROWS - 3], [9, ROWS - 2], [9, ROWS - 1]] }, 1)
  check('four rows clear at once', four.cleared === 4)
  check('the board is empty afterwards', filled(four.board) === 0)
}
{
  const b = emptyBoard()
  b[ROWS - 5][3] = 1
  for (const y of [ROWS - 3, ROWS - 1]) for (let x = 0; x < COLS - 1; x++) b[y][x] = 1
  const two = applyPlacement(b, { cells: [[9, ROWS - 3], [9, ROWS - 1]] }, 1)
  check('two non-adjacent rows clear together', two.cleared === 2)
  check('the survivor lands two rows lower', two.board[ROWS - 3][3] === 1)
}

console.log('\nmeasurements')
{
  const b = emptyBoard()
  b[ROWS - 1][0] = 1; b[ROWS - 2][0] = 1
  b[ROWS - 1][5] = 1
  b[ROWS - 3][2] = 1                                    // roofs two empty cells
  const h = columnHeights(b)
  check('column heights', h[0] === 2 && h[5] === 1 && h[2] === 3 && h[9] === 0)
  check('holes counted', countHoles(b) === 2, `got ${countHoles(b)}`)
  check('holes located', holesByColumn(b)[2] === 2)
}

console.log('\ntucks')
{
  const b = emptyBoard()
  b[15][1] = 1
  for (let y = 15; y < ROWS; y++) b[y][2] = 1
  const reach = enumeratePlacements(b, 'I')
  const drops = enumerateDrops(b, 'I')
  const key = (p) => p.cells.map((c) => c.join(',')).sort().join('|')
  const dk = new Set(drops.map(key))
  const extra = reach.filter((p) => !dk.has(key(p)))
  check('a tuck under an overhang is reachable', extra.length >= 1, `${extra.length} beyond straight drops`)
  check('straight drops are a subset of reachable', drops.every((p) => reach.some((r) => key(r) === key(p))))
}

console.log('\ntopping out')
{
  const b = emptyBoard()
  for (let x = 0; x < COLS; x++) for (let y = 0; y < 2; y++) b[y][x] = 1
  check('a blocked spawn offers no placement', PIECE_TYPES.every((p) => enumeratePlacements(b, p).length === 0))
  check('spawnBlocked agrees', PIECE_TYPES.every((p) => spawnBlocked(b, p)))

  const nearly = emptyBoard()
  for (let y = 2; y < ROWS; y++) for (let x = 0; x < COLS; x++) nearly[y][x] = 1
  check('a stack up to the spawn rows still allows play', PIECE_TYPES.some((p) => enumeratePlacements(nearly, p).length > 0))

  const onlyTop = emptyBoard()
  for (let x = 0; x < COLS; x++) onlyTop[0][x] = 1
  check('a blocked first row ends it for every piece', PIECE_TYPES.every((p) => enumeratePlacements(onlyTop, p).length === 0))
  check('the spawn column is where the piece is drawn',
    PIECE_TYPES.every((p) => spawnColumn(p) + PIECES[p][0][0].length <= COLS))
}

console.log('\nthe bag')
{
  const bag = makeBag(99)
  let fair = true
  for (let n = 0; n < 12; n++) {
    const seven = Array.from({ length: 7 }, () => bag())
    if (new Set(seven).size !== 7) fair = false
  }
  check('every seven pieces contain each shape once', fair)
  const a = makeBag(5), c = makeBag(5)
  check('the same seed gives the same sequence',
    Array.from({ length: 30 }, () => a()).join('') === Array.from({ length: 30 }, () => c()).join(''))
}

console.log('\na played-out game, checked every move')
{
  let b = emptyBoard()
  const bag = makeBag(7)
  let placed = 0, cleared = 0, score = 0
  const bySize = [0, 0, 0, 0, 0]
  let bad = null
  for (let i = 0; i < 400; i++) {
    const t = bag()
    const ps = enumeratePlacements(b, t)
    if (ps.length === 0) break
    const pick = heuristicPick(b, ps)

    for (const [x, y] of pick.cells) {
      if (occupied(b, x, y)) bad ??= `overlap at ${x},${y} on move ${i}`
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS) bad ??= `outside the field on move ${i}`
    }
    const ev = evaluate(b, pick)

    const res = applyPlacement(b, pick, 1)
    placed++
    bySize[res.cleared]++
    cleared += res.cleared
    score += LINE_SCORE[res.cleared]
    b = res.board

    if (filled(b) !== placed * 4 - cleared * COLS) {
      bad ??= `cell count drifted on move ${i}: ${filled(b)} vs ${placed * 4 - cleared * COLS}`
    }
    if (Math.max(...columnHeights(b)) > ROWS) bad ??= `stack above the ceiling on move ${i}`
    if (ev.holes !== countHoles(b)) bad ??= `evaluate disagreed about holes on move ${i}`
  }
  check('no invalid board in the whole game', bad === null, bad ?? `${placed} pieces, ${cleared} lines`)
  const expected = bySize.reduce((a, n, size) => a + n * LINE_SCORE[size], 0)
  check('score is exactly the line table applied to the clears', score === expected, `${score} vs ${expected}`)
  check('a competent player survives the cap', placed === 400, `${placed} pieces, ${cleared} lines`)
}

// and a bad player, which must actually reach the end
{
  let b = emptyBoard()
  const bag = makeBag(7)
  let seed = 1234
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296)
  let placed = 0
  let endedProperly = false
  for (let i = 0; i < 400; i++) {
    const t = bag()
    const ps = enumeratePlacements(b, t)
    if (ps.length === 0) { endedProperly = true; break }
    b = applyPlacement(b, ps[Math.floor(rand() * ps.length)], 1).board
    placed++
  }
  check('a careless player tops out rather than playing forever', endedProperly, `${placed} pieces`)
  check('the end state really does block the spawn',
    !endedProperly || spawnBlocked(b, PIECE_TYPES.find((p) => enumeratePlacements(b, p).length === 0)))
  check('and nothing was stacked above the ceiling', Math.max(...columnHeights(b)) <= ROWS)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)

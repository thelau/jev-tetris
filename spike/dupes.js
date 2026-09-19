// How distinguishable are the options we hand the model?
import { emptyBoard, enumeratePlacements, applyPlacement, makeBag } from '../src/tetris.js'
import { describePlacements } from '../src/describe.js'
import { heuristicPick } from '../src/heuristic.js'

let board = emptyBoard()
const bag = makeBag(7)
let totals = { opts: 0, unique: 0, boards: 0 }
for (let i = 0; i < 30; i++) {
  const type = bag()
  const ps = enumeratePlacements(board, type)
  if (!ps.length) break
  const { criteria } = describePlacements(board, ps)
  const texts = Object.values(criteria)
  const uniq = new Set(texts)
  totals.opts += texts.length
  totals.unique += uniq.size
  totals.boards++
  if (i < 3 || i === 14) {
    console.log(`\npiece ${i + 1} (${type}): ${texts.length} options, ${uniq.size} distinct`)
    const counts = {}
    for (const t of texts) counts[t] = (counts[t] || 0) + 1
    Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .forEach(([t, n]) => console.log(`  ×${n}  ${t}`))
  }
  board = applyPlacement(board, heuristicPick(board, ps)).board
}
console.log(`\nacross ${totals.boards} boards: ${totals.opts} options, ${totals.unique} distinct (${Math.round(100 * totals.unique / totals.opts)}%)`)

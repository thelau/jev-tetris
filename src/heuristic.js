// Baseline bots. Not part of the artwork — they exist so we can tell whether
// JEV is actually judging or just picking something plausible.

import { evaluate } from './tetris.js'

// El-Tetris weights. A competent player; clears thousands of lines.
const W = { height: -0.510066, lines: 0.760666, holes: -0.35663, bumps: -0.184483 }

export function heuristicPick(board, placements) {
  let best = null
  let bestScore = -Infinity
  for (const p of placements) {
    const ev = evaluate(board, p)
    const score =
      W.height * ev.aggregateHeight +
      W.lines * ev.cleared +
      W.holes * ev.holes +
      W.bumps * ev.bumpiness
    if (score > bestScore) { bestScore = score; best = p }
  }
  return best
}

export function randomPick(board, placements, rand = Math.random) {
  return placements[Math.floor(rand() * placements.length)]
}

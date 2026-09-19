// Pure Tetris engine. No DOM, no network. Runs in Node and the browser.
// All geometry and arithmetic lives here — the model never sees a number.

export const COLS = 10
export const ROWS = 20

const SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  Z: [[1, 1, 0], [0, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
}

function rotate(m) {
  const h = m.length
  const w = m[0].length
  const out = Array.from({ length: w }, () => Array(h).fill(0))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x][h - 1 - y] = m[y][x]
  return out
}

function uniqueRotations(m) {
  const seen = new Set()
  const out = []
  let cur = m
  for (let i = 0; i < 4; i++) {
    const key = JSON.stringify(cur)
    if (!seen.has(key)) { seen.add(key); out.push(cur) }
    cur = rotate(cur)
  }
  return out
}

export const PIECES = Object.fromEntries(
  Object.entries(SHAPES).map(([k, v]) => [k, uniqueRotations(v)])
)
export const PIECE_TYPES = Object.keys(SHAPES)

export function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null))
}

function cellsOf(matrix, ox, oy) {
  const cells = []
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (matrix[y][x]) cells.push([ox + x, oy + y])
    }
  }
  return cells
}

function collides(board, cells) {
  return cells.some(([x, y]) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y][x]))
}

// Every resting place reachable by actually manoeuvring the piece: move, rotate,
// drop, in any order. This is what a player can do, so it includes tucks (slide
// under an overhang after dropping) and spins.
//
// Breadth-first over (rotation, x, y) from the spawn. A state where the piece
// cannot move down any further is a lock position. Rotation is allowed to kick
// one column left or right, which is a simplification of SRS — close enough to
// reach the placements a player would find, without the full kick table.
export function enumeratePlacements(board, type) {
  const rots = PIECES[type]
  const spawnX = Math.floor((COLS - rots[0][0].length) / 2)
  // The piece spawns INSIDE the field, at the top rows — not in the space
  // above it. Spawning above the ceiling meant a piece could always slide in
  // somewhere, so the game never topped out and the waiting piece drew over
  // the stack. If the spawn is blocked, the game is over; that is the rule.
  const spawnY = 0
  const fits = (r, x, y) => !collides(board, cellsOf(rots[r], x, y))
  if (!fits(0, spawnX, spawnY)) return []

  const key = (r, x, y) => `${r}:${x}:${y}`
  const seen = new Set([key(0, spawnX, spawnY)])
  const queue = [[0, spawnX, spawnY]]
  const locks = new Map()

  while (queue.length) {
    const [r, x, y] = queue.shift()

    if (!fits(r, x, y + 1)) {
      const cells = cellsOf(rots[r], x, y)
      if (!cells.some(([, cy]) => cy < 0)) locks.set(key(r, x, y), { type, rot: r, x, y, cells })
    }

    const moves = [[r, x - 1, y], [r, x + 1, y], [r, x, y + 1]]
    if (rots.length > 1) {
      for (const nr of [(r + 1) % rots.length, (r + rots.length - 1) % rots.length]) {
        for (const dx of [0, -1, 1]) moves.push([nr, x + dx, y])
      }
    }
    for (const [nr, nx, ny] of moves) {
      if (ny > ROWS) continue
      const k = key(nr, nx, ny)
      if (seen.has(k) || !fits(nr, nx, ny)) continue
      seen.add(k)
      queue.push([nr, nx, ny])
    }
  }

  // stable, readable ids: left to right, top to bottom
  return [...locks.values()]
    .sort((a, b) => a.x - b.x || a.y - b.y || a.rot - b.rot)
    .map((p, i) => ({ id: `p${i}`, ...p }))
}

// Where a piece enters the field, so the renderer and the engine agree.
export function spawnColumn(type) {
  return Math.floor((COLS - PIECES[type][0][0].length) / 2)
}
export function spawnBlocked(board, type) {
  return collides(board, cellsOf(PIECES[type][0], spawnColumn(type), 0))
}

// The old behaviour: straight drops only. Kept so the two can be compared.
export function enumerateDrops(board, type) {
  const out = []
  const rots = PIECES[type]
  for (let rot = 0; rot < rots.length; rot++) {
    const m = rots[rot]
    const w = m[0].length
    for (let x = 0; x + w <= COLS; x++) {
      let y = -m.length
      while (!collides(board, cellsOf(m, x, y + 1))) y++
      const cells = cellsOf(m, x, y)
      if (cells.some(([, cy]) => cy < 0)) continue // buried in the ceiling: game over territory
      out.push({ id: `p${out.length}`, type, rot, x, y, cells })
    }
  }
  return out
}

export function applyPlacement(board, placement, mark = 1) {
  const next = board.map((r) => r.slice())
  for (const [x, y] of placement.cells) if (y >= 0) next[y][x] = mark
  const cleared = []
  for (let y = 0; y < ROWS; y++) if (next[y].every((c) => c)) cleared.push(y)
  for (const y of cleared) {
    next.splice(y, 1)
    next.unshift(Array(COLS).fill(null))
  }
  return { board: next, cleared: cleared.length, clearedRows: cleared }
}

export function columnHeights(board) {
  const h = Array(COLS).fill(0)
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (board[y][x]) { h[x] = ROWS - y; break }
    }
  }
  return h
}

export function holesByColumn(board) {
  const per = Array(COLS).fill(0)
  for (let x = 0; x < COLS; x++) {
    let roofed = false
    for (let y = 0; y < ROWS; y++) {
      if (board[y][x]) roofed = true
      else if (roofed) per[x]++
    }
  }
  return per
}

export function countHoles(board) {
  return holesByColumn(board).reduce((a, b) => a + b, 0)
}

export function bumpiness(heights) {
  let b = 0
  for (let i = 0; i < heights.length - 1; i++) b += Math.abs(heights[i] - heights[i + 1])
  return b
}

// Depth of the deepest one-wide notch, and where it is.
export function deepestWell(heights) {
  let best = { depth: 0, x: -1 }
  for (let x = 0; x < heights.length; x++) {
    const left = x === 0 ? ROWS : heights[x - 1]
    const right = x === heights.length - 1 ? ROWS : heights[x + 1]
    const depth = Math.min(left, right) - heights[x]
    if (depth > best.depth) best = { depth, x }
  }
  return best
}

// Everything the describer and the heuristic need about one candidate move.
export function evaluate(board, placement) {
  const beforePer = holesByColumn(board)
  const before = { heights: columnHeights(board), holes: beforePer.reduce((a, b) => a + b, 0) }
  const { board: after, cleared } = applyPlacement(board, placement)
  const heights = columnHeights(after)
  const holes = countHoles(after)
  const landingRow = Math.min(...placement.cells.map(([, y]) => y))

  // How much already-buried space this move seals in deeper, and how much it frees.
  const cols = [...new Set(placement.cells.map(([x]) => x))]
  const sealsExisting = cols.reduce((a, x) => a + beforePer[x], 0)
  const freed = Math.max(0, before.holes - holes)

  return {
    after,
    cleared,
    holes,
    sealsExisting,
    freed,
    holesCreated: Math.max(0, holes - before.holes),
    maxHeight: Math.max(...heights),
    aggregateHeight: heights.reduce((a, b) => a + b, 0),
    bumpiness: bumpiness(heights),
    bumpinessDelta: bumpiness(heights) - bumpiness(before.heights),
    well: deepestWell(heights),
    wellBefore: deepestWell(before.heights),
    landingRow,
    landingDepth: ROWS - landingRow,
    heights,
  }
}

export const LINE_SCORE = [0, 40, 100, 300, 1200]

// Deterministic 7-bag so every player faces the identical sequence.
export function makeBag(seed) {
  let s = seed >>> 0
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  let queue = []
  return () => {
    if (queue.length === 0) {
      queue = PIECE_TYPES.slice()
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[queue[i], queue[j]] = [queue[j], queue[i]]
      }
    }
    return queue.shift()
  }
}

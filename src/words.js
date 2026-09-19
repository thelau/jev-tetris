// Control: a player that sees EXACTLY what the model sees — the option
// sentences, nothing else — and scores them by keyword with hand-set numbers.
// No API call, no board access, no metrics. If this matches JEV, then the
// sentences already contain the answer and the model is only decoding them.

const RULES = [
  [/Traps no new space/, 100],
  [/Traps one new pocket/, -60],
  [/Traps two new pockets/, -120],
  [/Traps three new pockets/, -180],
  [/Traps four or more new pockets/, -240],

  [/frees space that was trapped/, 80],
  [/piles on top of a great deal of already-trapped/, -60],
  [/piles on top of space that was already trapped/, -30],

  [/Clears one line/, 40],
  [/Clears two lines/, 100],
  [/Clears three lines/, 180],
  [/Clears four lines at once/, 300],

  [/Flattens the surface out/, 30],
  [/Tidies the surface slightly/, 15],
  [/Leaves a step in the surface/, -10],
  [/Leaves a jagged edge behind/, -25],

  [/The stack stays low/, 40],
  [/The stack reaches a third of the way up/, 20],
  [/The stack is well above halfway/, -30],
  [/The stack is getting dangerously tall/, -70],
  [/The stack is nearly at the top/, -120],

  [/It fills the deep notch/, 20],
  [/It opens a deep narrow notch/, -20],
]

export function scoreSentence(text) {
  let total = 0
  for (const [re, pts] of RULES) if (re.test(text)) total += pts
  return total
}

export function wordsPick(placements, criteria) {
  let best = null
  let bestScore = -Infinity
  for (const p of placements) {
    const s = scoreSentence(criteria[p.id] ?? '')
    if (s > bestScore) { bestScore = s; best = p }
  }
  return best
}

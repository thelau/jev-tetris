# What JEV decides, and what the code decides

So there is no confusion about who is playing.

## The division

**The code does all of it except the choosing.**

Every frame, `src/tetris.js` searches every resting place the piece can actually
be manoeuvred into: a breadth-first walk over move, rotate and drop from the
spawn, so tucks and spins count — the placements a player could reach, not just
the ones a straight drop finds. That is 23 options on an average turn, 37 at
most, against an API ceiling of 255. Each one is then simulated and measured:
lines cleared, holes created, surface roughness, resulting height, whether a well
gets sealed. Not one of those numbers is ever sent.

Rotation is allowed to kick one column left or right, a simplification of the
standard SRS kick table — close enough to reach what a player would find.

`src/describe.js` turns each measured outcome into a sentence, every option
built from the identical template:

> Traps one new pocket of space underneath, for good. Clears no lines. Leaves a
> step in the surface. The stack stays low. It goes at the left, lying flat.

JEV gets the board described in five short lines, and those sentences as the
options of a `choice` question. It answers with a probability for each one.

**JEV chooses. The code does the geometry, the arithmetic, and the weighting.**

## What the glow is — and is not

It is **not** anticipation, lookahead, or a plan.

Each of the ~34 candidate placements comes back with a probability. A cell glows
by the summed probability of every candidate that would occupy it. Cells that
many well-liked options share glow brightest; cells only one option touches stay
dim. The white outline is the placement that won the blend.

It is the spread of the model's opinion about **this one move**. There is no
future in it. The next piece appears in the state as a single line of context,
and JEV is never asked anything about it.

## The five questions

Five `choice` questions over the same option set, plus two ambient ones, all in
a single request — evaluated in parallel, so seven questions cost barely more
latency than one.

| Question | Asks | Weight in the blend |
|---|---|---|
| `sealed` | which option traps the least empty space underneath | 0.55 |
| `clears` | which removes the most complete rows | 0.22 |
| `unburied` | which does most to keep already-trapped space reachable | 0.15 |
| `low` | which keeps the stack furthest from the top | 0.05 |
| `flat` | which leaves the most even surface | 0.03 |
| `danger` | a `score`: how much trouble is this board in | not used to move |
| `doomed` | a `noul`: this board cannot be recovered | not used to move |

The weights are ours, fitted against measured play — that is the dial we control.
The judgements are entirely the model's. Nothing in the code vetoes a move it
picks; a bad choice is played.

## Provenance

Every call is written to `runs/<timestamp>.jsonl` before the answer is used:
the exact request, the raw response with all probabilities and confidences, the
latency, and a running total. Nothing is summarised or filtered on the way in.

```
node tools/runlog.js                 # summarise the newest run
node tools/runlog.js runs/x.jsonl    # or a specific one
```

The screen carries the same thing live, under the score:
`JEV-1.13.0 · 96 CALLS · 812K TOK · $0.034`. The model id is whatever the API
returned, not a string we typed.

## What it costs

Input tokens are metered; output is not. Roughly **8,800 input tokens per move**
— the ~34 option sentences repeated across five questions is most of it.

| | Calls | Input tokens | Cost |
|---|---|---|---|
| One move | 1 | ~8,800 | $0.00037 |
| A 100-piece game | 100 | ~880,000 | ~$0.037 |
| A 160-piece game | 160 | ~1.4M | ~$0.059 |
| An hour on a loop | ~3,600 | ~32M | ~$1.33 |

At $0.042 per million input tokens. The vendor says this is below cost, so treat
every figure here as provisional — an hour of this running could get more
expensive without warning.

Cost scales with **options × questions**, both of which live in our code. Asking
five questions instead of one multiplies the bill roughly fivefold and the
latency by almost nothing — which is the whole economic shape of this model, and
why the design leans on it.

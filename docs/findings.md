# Can JEV play Tetris?

Yes — verifiably it, not the code around it. But worse than a 23-line keyword
table reading the same sentences. Both of those are measured, and the controls
that establish them are below the headline result, not buried at the end.

All geometry happens in our code. The model never sees a number — every candidate
placement arrives as a sentence describing what the board becomes. See
[what-jev-does.md](what-jev-does.md) for the exact division of labour.

## Result

Three seeds, 200-piece cap, identical piece sequences for every player.

| Player | Pieces survived | Lines cleared |
|---|---|---|
| Random | 26 · 19 · 22 | 0 · 0 · 0 |
| **JEV** | **155 · 123 · 200** | **46 · 34 · 76** |
| Heuristic (El-Tetris) | 200 · 200 · 200 | 77 · 75 · 78 |

On seed 42 it cleared 76 lines against the heuristic's 78 and never topped out.
On the other two it dies. Median latency ~380ms, so a game runs 60 to 130
seconds and costs about six cents.

## Is it really JEV playing? Three controls

Run these before believing anything above.

| Player | Pieces | Lines | What it shows |
|---|---|---|---|
| Random | 26 · 19 · 22 | 0 · 0 · 0 | the floor |
| **JEV, probabilities shuffled** | **26 · 22 · 25** | **0 · 0 · 0** | its ordering is carrying the whole game |
| JEV, uniform voice weights | 63 · 84 · 54 | 10 · 18 · 7 | our weighting helps but is not the player |
| **JEV as built** | **155 · 123 · 200** | **46 · 34 · 76** | |
| **Keyword lookup on the same sentences** | **200 · 200 · 200** | **78 · 78 · 79** | the sentences already contain the answer |
| El-Tetris heuristic | 200 · 200 · 200 | 77 · 75 · 78 | the ceiling |

**The shuffle control settles the honesty question.** Keep every number the model
returned and scramble only which option each belongs to, and play drops to
exactly random — 0 lines, dead at 26 pieces, indistinguishable from the random
bot. Nothing in our code is quietly steering. Remove the model's ranking and
there is no game.

**The keyword control settles the capability question, and not in JEV's favour.**
`src/words.js` is 23 lines of regex over the identical option sentences — no API,
no board access, no metrics. It matches the heuristic and beats JEV outright.
So our descriptions already encode enough to play well, and JEV is a lossy reader
of them.

The defensible claim: *given only prose, JEV ranks options well enough to play
credible Tetris, far above random.* Not: *JEV is good at Tetris.*

## What these numbers cannot support

Written after an adversarial review that reproduced the baselines and replayed
the logs. Every point below survived that review.

**Three seeds is not enough for a ratio.** Line counts against the heuristic run
0.60, 0.45 and 0.97 — mean 0.67, sd 0.27, a 95% interval of roughly [0.01, 1.34].
That spans "no better than random" to "matches the heuristic." Any single figure
like "60% of a heuristic" is unsupported, and an earlier version of this document
said exactly that. It has been removed.

**The configuration was selected on the same three seeds.** Bundled vs composite,
sum vs product, the voice weights, the sentence rewrites — all chosen by watching
these runs. The headline is an in-sample best, not a held-out result.

**Most of the line count comes from weights we fitted, not from the model.**
With every voice weighted equally the mean drops to about 11.7 lines; as built it
is about 52. So roughly three quarters of the scoring is attributable to our own
weighting, applied on top of the model's ranking.

**The five voices are, in practice, close to one.** Replaying 1,578 logged turns,
the blended pick equals the `sealed` voice's own argmax **91%** of the time
(`unburied` 81%, `clears` 55%, `low` 45%, `flat` 32%). Splitting the question into
five genuinely helped — it doubled the score — but the architecture story is
overstated: what the system mostly asks is "which option traps the least space",
weighted 0.55 by us, which is the same feature carrying the largest coefficient in
the keyword baseline.

**The experiment that would settle it** and which has not been run: generate a few
thousand boards along *heuristic* trajectories, so the board distribution is fixed
and the death-spiral confound is gone, then measure per-turn rank correlation
between JEV's field and El-Tetris over the same options, fitting any weights on
half and evaluating on the other half.

```
node spike/play.js --player jev --shuffle --pieces 200     # the honesty control
node spike/play.js --player jev --uniform --pieces 200     # remove our weights
node spike/play.js --player words --pieces 200             # the number to beat
```

## What moved the needle, in order

**1. Deleting one self-contradictory sentence. Roughly doubled everything.**

Every option carried two sentences written by different functions:

> Traps one new pocket of space underneath, for good.
> **It rests on solid ground with nothing trapped below it.**

The first reported newly-created holes, the second reported *pre-existing* ones,
so on a clean board a hole-creating move announced that it trapped nothing. To a
model that reads literally this is a flat contradiction, and it was costing half
the game.

| Seed | With the contradiction | Without |
|---|---|---|
| 7 | 76 pieces / 16 lines | 155 / 46 |
| 21 | 101 / 25 | 123 / 34 |
| 42 | 110 / 29 | 200 / 76 |

Found by reading the run log, not by reasoning about the code. Worth building the
logging before the tuning next time.

**2. One bundled question → five single-purpose ones. 8 lines → 18.**

The first version asked one `choice` with the instruction *"avoid burying gaps,
keep the surface even, keep the stack low."* Three judgements in one question.
Mean confidence 0.40, 23 holes buried in 60 pieces.

Splitting it into five questions over the same option set — each asking about one
thing — and blending the five distributions with our own weights more than
doubled the line count and halved the holes. This is the documented
composite-scoring pattern.

**3. Weighting the voices by measured play rather than intuition.**

Scoring each voice alone showed `low` and `flat` were destructive while carrying
28% of the vote. Reweighted toward `sealed` and `clears`.

Caveat: per-voice scores are confounded by trajectory. Each voice is only judged
on the boards the blend actually reached, and on a clean board every voice looks
good. Don't read those numbers as clean measurements.

**4. Other wording changes mattered least.** Leading with consequence instead of
position, naming where buried gaps are, finer bands on height and hole counts:
confidence rose 0.35 → 0.41, survival barely moved.

## Tucks and spins

The first version enumerated straight drops only, which is standard for
placement-search bots but means the model is offered a smaller world than a
player has. Replacing it with a reachability search — breadth-first over move,
rotate and drop — adds the placements you can only get to by sliding under an
overhang.

| Seed | Straight drops | With tucks and spins |
|---|---|---|
| 7 | 155 pieces / 46 lines | 196 / 62 |
| 21 | 123 / 34 | 104 / 28 |
| 42 | 200 / 76 | 200 / 77 |

Better on one seed, worse on another, unchanged on the third: **no effect that
three seeds can distinguish.** It is in because it is the correct rule, not
because it measurably helps. Option counts rise from 23.2 to 23.2 on average and
from 34 to 37 at most — tucks only exist where there are overhangs, and a tidy
board has none — so it costs essentially nothing in tokens either.

## What did not work

**Multiplicative blending.** A weighted geometric mean should let any voice veto
an option it hates. In practice the distributions are sparse — most options get
exactly zero from most voices — so the product rewards options everyone finds
mildly acceptable over options one voice is certain about. 83 pieces → 56.

## The failure mode

It is bistable. From a tidy board it plays close to a competent heuristic. One
bad blunder and every voice degrades at once and it rarely recovers — holes went
11 → 51 in nineteen pieces in one run. This matches the published note that
accuracy falls as state gets cluttered: our description of a messy board is
necessarily vaguer than our description of a clean one.

Confidence does not predict the blunders. One catastrophic turn came back at
0.48, right at the run average.

## Reproducing

```
node spike/play.js --player heuristic --pieces 200      # baseline
node spike/play.js --player random --pieces 200         # floor
node spike/play.js --player jev --pieces 200            # the real thing
node spike/play.js --player jev --mode single           # the bundled question
node spike/play.js --player jev --blend product         # the geometric mean
node spike/dupes.js                                     # are options distinguishable
node tools/runlog.js                                    # what the last run cost
```

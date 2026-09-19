# JEV Tetris

A Tetris played by a model that cannot write, cannot see the board, and has
never been told what Tetris is.

JEV answers typed questions. You give it the possible answers and it returns a
probability for each one. It cannot generate text, so it cannot be asked "where
should this go" in the usual sense.

So the code does the geometry. Every frame it searches for all the places the
falling piece can be manoeuvred into — moving, rotating and dropping in any
order, so tucks and spins count — and describes each one in a sentence:

> Traps no new space underneath. Clears one line. Flattens the surface out. The
> stack stays low. It goes at the centre, lying flat.

Those sentences go to JEV as the options of a multiple-choice question. It sends
back a probability for every one, in about 380ms. The code plays whichever it
ranked highest.

Because you get a probability for all of them and not just a winner, the board
can show the whole answer at once. Before the piece drops, every cell lights up
by how much of the model's preference rests on it, with a white ring on the
placement it took. Then it commits and the field goes out.

Settled blocks are dimmed by how confident the model was when it placed them, so
the wall it builds is a readable record of its own uncertainty.

![the decision](docs/stills/states/3-decided-desktop.png)

## Run it

Needs Node 22 or later. There is nothing to install: no dependencies, no build
step. Two fonts load from Google Fonts at runtime.

Get a key from [typesafe.ai](https://typesafe.ai), then:

```bash
git clone https://github.com/thelau/jev-tetris && cd jev-tetris
cp .env.example .env         # put your TYPESAFE_API_KEY in it
npm run dev                  # -> http://localhost:5173
```

Open it and press START. With no key there is no START button, and the page says
why instead of failing.

A game costs a few cents. The server refuses to spend past 1500 calls or $1,
whichever comes first, and the key never leaves it.

If you do not have a key, everything still runs on fake answers. The whole
interface works; it just plays badly:

```bash
npm run dev:mock             # -> http://localhost:5173
```

| | |
|---|---|
| `?hold=900` | hold the field on screen longer, for filming |
| `?seed=42` | fix the piece sequence |
| `?auto=1` | skip the start screen and restart forever |
| `HOW IT WORKS` | the only control apart from START |
| `M` | mute. The sound is eight-bit and generated in the browser |

## Tests

```bash
npm test                     # both suites, no key and no cost
npm run test:engine          # the rules, no browser
npm run test:ui              # the interface, headless, on fake answers
```

`test:engine` is 33 checks on the game itself: no placement overlaps or floats,
lines clear and the rows above fall, a blocked spawn ends the game, the bag is
fair and repeatable. It plays 400 moves and audits the board after each one for
cell-count drift, then makes a careless player lose so the ending is exercised
and not assumed.

`test:ui` drives the page in headless Chrome: it plays, nothing scrolls at five
viewport sizes, the panel opens and closes, a dropped connection stalls instead
of ending the game, and START begins a new round.

## Does JEV actually play it?

The controls matter more than the score, so they come first. Three seeds,
300-piece cap.

| Player | Pieces | Lines |
|---|---|---|
| Random | 20 · 21 · 22 | 0 · 0 · 0 |
| **JEV, probabilities shuffled** | 24 · 18 · 18 | 0 · 0 · 0 |
| **JEV as built** | 83 · 300 · 90 | 23 · 115 · 23 |
| **Keyword table on the same sentences** | 300 · 210 · 300 | 118 · 73 · 118 |
| El-Tetris heuristic | 300 · 300 · 300 | 118 · 118 · 116 |

Row two is the honesty check. Keep every number the model returned and scramble
only which option each belongs to. Play drops to the random line: zero lines, 18
to 24 pieces. Nothing in the code is steering behind the model, because without
its ordering there is no game.

Row four is less flattering. `src/words.js` is 23 lines of regular expressions
over the same sentences, with no model involved at all, and it beats JEV. The
descriptions already carry enough to play well, and JEV reads them imperfectly.

So the claim this repo supports is narrow: given only prose, JEV ranks the
options well enough to play real Tetris, far above chance. It is not that JEV is
good at Tetris.

Three more things cut against it, all in [docs/findings.md](docs/findings.md).
Three seeds cannot support a ratio — one seed nearly matches a competent bot and
two manage a fifth of it. The configuration was tuned on those same three seeds.
And weighting the five questions equally collapses the score, so a good deal of
the performance comes from weights we fitted rather than from the model. Across
1,578 logged turns the blended pick matches one question's own top choice 91% of
the time, which means the five voices are closer to one than the architecture
suggests.

```bash
npm run play       # the real thing            (costs money)
npm run control    # the shuffle check         (costs money)
npm run baseline   # the number to beat        (free)
npm run ceiling    # a competent bot           (free)
npm run costs      # what the last run spent   (free)
```

- [docs/findings.md](docs/findings.md) — everything measured, including what failed
- [docs/what-jev-does.md](docs/what-jev-does.md) — the division of labour, and the costs

## Changing it

Two files are worth opening.

`src/describe.js` turns geometry into English and holds the five questions the
model is asked. Change a question and the game changes character. The weights
are ours; the probabilities are its.

`public/main.js` is the render. All of the geometry is solved from one number,
the cell size, by search, so there are no breakpoints and no device branches —
change `metrics()` and the rest follows. The palette is at the top.

Every call is written to `runs/<timestamp>.jsonl` before its answer is used.
`npm run costs` summarises latency, tokens and money. That log is how the worst
bug in the project was found: two sentences in the same option contradicted each
other and were costing half the game.

## Layout

```
src/tetris.js      the engine. every number in the project lives here
src/describe.js    geometry into English, and the five questions
src/jev.js         API client
src/heuristic.js   baseline bots to measure against
src/words.js       the keyword table that beats the model
server.js          static files, one proxy route holding the key, and --mock
public/main.js     the game loop and the render
public/audio.js    the sound, synthesised rather than sampled
spike/             the headless experiments that settled the design
tools/engine-test.js   the rules, tested without a browser
tools/e2e.js       the interface, tested headless
tools/states.js    screenshots every state at both ends of the size range
tools/cdp.js       enough DevTools protocol to drive headless Chrome
tools/runlog.js    what a run cost
runs/              every call, raw, as it happened (gitignored)
```

JEV launched in September 2026 and is priced below cost by the vendor's own
admission, so treat the money here as provisional.

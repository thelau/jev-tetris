// Does JEV actually play Tetris? Headless, no pixels.
// Same seeded piece sequence for every player, so the numbers compare.
//
//   node spike/play.js --player heuristic --pieces 200
//   node spike/play.js --player jev --pieces 40 --dump

import { emptyBoard, enumeratePlacements, applyPlacement, columnHeights, countHoles, makeBag, LINE_SCORE, evaluate } from '../src/tetris.js'
import { describeBoard, describePlacements, buildQuestions, blend, VOICES,
         describeBoardV2, describePlacementsV2, buildQuestionsV2 } from '../src/describe.js'
import { heuristicPick, randomPick } from '../src/heuristic.js'
import { wordsPick } from '../src/words.js'
import { ask, readChoice, readScore, readNoul } from '../src/jev.js'

try { process.loadEnvFile('.env') } catch {}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const flag = (name) => process.argv.includes(`--${name}`)

const player = arg('player', 'heuristic')
const maxPieces = Number(arg('pieces', 40))
const seed = Number(arg('seed', 7))
const dump = flag('dump')
const bare = flag('bare') // drop the ambient questions, to isolate latency
const mode = arg('mode', 'composite') // composite | single
const blendMode = arg('blend', 'sum') // product | sum
const api = arg('api', 'v1')          // v1 = flat strings, v2 = structured per-question
const shuffle = flag('shuffle')   // control: permute the model's probabilities
const uniform = flag('uniform')   // control: give every voice the same weight

let rndState = seed >>> 0
const rand = () => ((rndState = (rndState * 1103515245 + 12345) >>> 0) / 4294967296)

async function jevPick(board, placements, current, next, log) {
  let state
  let questions
  if (api === 'v2') {
    const { perVoice } = describePlacementsV2(board, placements)
    state = describeBoardV2(board, current, next)
    questions = buildQuestionsV2(perVoice)
  } else {
    const { criteria } = describePlacements(board, placements)
    state = describeBoard(board, current, next)
    questions = buildQuestions(criteria, mode)
  }
  if (bare) { delete questions.danger; delete questions.doomed }

  const { raw, ms } = await ask({ state, questions })
  if (dump && log.first) {
    console.log('\n--- raw first response ---')
    console.log(JSON.stringify(raw, null, 2).slice(0, 4000))
    console.log('--- state sent ---')
    console.log(JSON.stringify(state, null, 2))
    console.log('--- a sample option ---')
    console.log(JSON.stringify(Object.values(questions)[0].criteria?.[placements[0].id] ?? {}).slice(0, 300))
    console.log('---\n')
    log.first = false
  }

  const ids = placements.map((p) => p.id)
  let pickedId
  let confidence

  if (mode === 'single') {
    const choice = readChoice(raw, 'move')
    pickedId = choice?.picked
    confidence = choice?.confidence
  } else {
    const dists = {}
    const confs = []
    for (const name of Object.keys(VOICES)) {
      const c = readChoice(raw, name)
      if (!c) continue
      dists[name] = shuffle ? permute(c.probabilities, ids) : c.probabilities
      if (c.confidence != null) confs.push(c.confidence)
    }
    const uw = Object.fromEntries(Object.keys(VOICES).map((k) => [k, 1 / Object.keys(VOICES).length]))
    const field = blend(dists, ids, blendMode, uniform ? uw : null)
    pickedId = ids.reduce((a, b) => (field[b] > field[a] ? b : a), ids[0])
    log.voicePicks = Object.fromEntries(Object.entries(dists).map(([n, pr]) =>
      [n, ids.reduce((a, b) => ((pr?.[b] ?? 0) > (pr?.[a] ?? 0) ? b : a), ids[0])]))
    log.nonzero = Object.fromEntries(Object.entries(dists).map(([n, pr]) =>
      [n, ids.filter((i) => (pr?.[i] ?? 0) > 0.001).length]))
    // What each voice would have done on its own, scored against what was available.
    const evs = Object.fromEntries(placements.map((pl) => [pl.id, evaluate(board, pl)]))
    const bestHoles = Math.min(...placements.map((pl) => evs[pl.id].holesCreated))
    const bestLines = Math.max(...placements.map((pl) => evs[pl.id].cleared))
    log.solo ||= {}
    for (const [n, pr] of Object.entries(dists)) {
      const top = ids.reduce((a, b) => ((pr?.[b] ?? 0) > (pr?.[a] ?? 0) ? b : a), ids[0])
      const allZero = ids.every((i) => (pr?.[i] ?? 0) <= 0.001)
      log.solo[n] ||= { avoidable: 0, holes: 0, lines: 0, missedLines: 0, blind: 0 }
      log.solo[n].avoidable += Math.max(0, evs[top].holesCreated - bestHoles)
      log.solo[n].holes += evs[top].holesCreated
      log.solo[n].lines += evs[top].cleared
      log.solo[n].missedLines += Math.max(0, bestLines - evs[top].cleared)
      if (allZero) log.solo[n].blind += 1
    }
    confidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null
  }

  const picked = placements.find((p) => p.id === pickedId)
  log.latency.push(ms)
  if (confidence != null) log.confidence.push(confidence)
  log.last = {
    ms,
    confidence,
    danger: readScore(raw, 'danger')?.score,
    doomed: readNoul(raw, 'doomed')?.p,
    options: placements.length,
  }
  if (!picked) throw new Error(`Could not read a choice from the response. Got id=${pickedId}`)
  return picked
}

async function run() {
  let board = emptyBoard()
  const nextPiece = makeBag(seed)
  let current = nextPiece()
  let upcoming = nextPiece()

  const log = { latency: [], confidence: [], damage: [], first: true, last: null }
  let lines = 0
  let score = 0
  let pieces = 0

  console.log(`player=${player} api=${api}${shuffle ? ' SHUFFLED' : ''}${uniform ? ' UNIFORM' : ''} mode=${mode} blend=${blendMode} pieces=${maxPieces} seed=${seed}${bare ? ' bare' : ''}`)

  while (pieces < maxPieces) {
    const placements = enumeratePlacements(board, current)
    if (placements.length === 0) break

    let pick
    if (player === 'jev') pick = await jevPick(board, placements, current, upcoming, log)
    else if (player === 'random') pick = randomPick(board, placements, rand)
    else if (player === 'words') {
      const { criteria } = describePlacements(board, placements)
      pick = wordsPick(placements, criteria)
    }
    else pick = heuristicPick(board, placements)

    const evals = placements.map((p) => ({ p, ev: evaluate(board, p) }))
    const bestAvail = Math.min(...evals.map((e) => e.ev.holesCreated))
    const tookEv = evals.find((e) => e.p.id === pick.id).ev
    if (player === 'jev') {
      log.damage.push({ took: tookEv.holesCreated, best: bestAvail, cleanAvail: evals.filter((e) => e.ev.holesCreated === 0).length })
    }
    const placed = current
    const { board: after, cleared } = applyPlacement(board, pick)
    board = after
    lines += cleared
    score += LINE_SCORE[cleared]
    pieces++
    current = upcoming
    upcoming = nextPiece()

    if (player === 'jev') {
      const l = log.last
      process.stdout.write(
        `${String(pieces).padStart(3)}  ${placed}  opts ${String(l.options).padStart(2)}  ` +
        `${String(l.ms).padStart(4)}ms  conf ${fmt(l.confidence)}  danger ${fmt(l.danger)}  ` +
        `lines ${lines}  holes ${countHoles(board)}  top ${Math.max(...columnHeights(board))}  ` +
        `dmg ${log.damage.at(-1).took}/${log.damage.at(-1).best} clean ${log.damage.at(-1).cleanAvail}  ` +
        `voices ${Object.values(log.voicePicks || {}).join(',')}\n`
      )
    }
  }

  const heights = columnHeights(board)
  console.log('\n--- result ---')
  console.log(`pieces placed : ${pieces}${pieces < maxPieces ? '  (TOPPED OUT)' : ''}`)
  console.log(`lines cleared : ${lines}`)
  console.log(`score         : ${score}`)
  console.log(`holes left    : ${countHoles(board)}`)
  console.log(`max height    : ${Math.max(...heights)}`)
  if (log.latency.length) {
    const s = [...log.latency].sort((a, b) => a - b)
    console.log(`latency       : median ${s[Math.floor(s.length / 2)]}ms  min ${s[0]}ms  max ${s[s.length - 1]}ms`)
  }
  if (log.damage.length) {
    const avoidable = log.damage.filter((d) => d.took > d.best)
    const buriedTotal = log.damage.reduce((a, d) => a + d.took, 0)
    const avoidableTotal = avoidable.reduce((a, d) => a + (d.took - d.best), 0)
    console.log(`holes buried  : ${buriedTotal}, of which ${avoidableTotal} were avoidable`)
    console.log(`bad turns     : ${avoidable.length} of ${log.damage.length} turns took avoidable damage`)
    const hadClean = log.damage.filter((d) => d.cleanAvail > 0 && d.took > 0)
    console.log(`ignored clean : ${hadClean.length} turns buried space while a clean option existed`)
  }
  if (log.solo) {
    console.log('\nper-voice, judged alone:')
    console.log('  voice      holes buried  avoidable  lines taken  lines missed  flat-dist turns')
    for (const [n, v] of Object.entries(log.solo)) {
      console.log(`  ${n.padEnd(10)} ${String(v.holes).padStart(11)} ${String(v.avoidable).padStart(10)} ${String(v.lines).padStart(12)} ${String(v.missedLines).padStart(13)} ${String(v.blind).padStart(15)}`)
    }
  }
  if (log.confidence.length) {
    const avg = log.confidence.reduce((a, b) => a + b, 0) / log.confidence.length
    console.log(`confidence    : mean ${avg.toFixed(3)}`)
  }
}

const fmt = (v) => (v == null ? ' -- ' : Number(v).toFixed(2))

run().catch((e) => { console.error('\n' + e.message); process.exit(1) })

// Control: keep the model's numbers, destroy which option each belongs to.
// If play holds up, the model's ordering was never carrying the game.
function permute(probs, ids) {
  const vals = ids.map((i) => probs?.[i] ?? 0)
  for (let i = vals.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[vals[i], vals[j]] = [vals[j], vals[i]]
  }
  return Object.fromEntries(ids.map((id, k) => [id, vals[k]]))
}

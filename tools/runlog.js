// Summarise a run log: what was asked, what came back, what it cost.
//
//   node tools/runlog.js                  # newest run
//   node tools/runlog.js runs/x.jsonl     # a specific one

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

let file = process.argv[2]
if (!file) {
  const dir = join(process.cwd(), 'runs')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort()
  if (!files.length) { console.error('no runs yet'); process.exit(1) }
  file = join(dir, files.at(-1))
}

const lines = (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean)
const calls = lines.map((l) => JSON.parse(l))
if (!calls.length) { console.error('empty log'); process.exit(1) }

const ms = calls.map((c) => c.ms).sort((a, b) => a - b)
const last = calls.at(-1).cumulative
const models = [...new Set(calls.map((c) => c.response?.model).filter(Boolean))]
const questions = Object.keys(calls[0].request.questions)
const options = calls.map((c) => Object.keys(c.request.questions[questions[0]].criteria ?? {}).length)

const confs = []
for (const c of calls) {
  for (const a of Object.values(c.response?.answers ?? {})) {
    if (a.confidence != null) confs.push(a.confidence)
  }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1)

console.log(`\n${file}\n`)
console.log(`model         ${models.join(', ') || 'unknown'}`)
console.log(`calls         ${calls.length}`)
console.log(`questions     ${questions.length} per call: ${questions.join(', ')}`)
console.log(`options       ${Math.min(...options)}–${Math.max(...options)} per choice question`)
console.log(`latency       median ${ms[Math.floor(ms.length / 2)]}ms   min ${ms[0]}ms   max ${ms.at(-1)}ms`)
console.log(`confidence    mean ${mean(confs).toFixed(3)} across ${confs.length} answers`)
console.log(`input tokens  ${last.inputTokens.toLocaleString()}  (${Math.round(last.inputTokens / calls.length).toLocaleString()} per call)`)
console.log(`output tokens ${last.outputTokens.toLocaleString()}  (unmetered)`)
console.log(`cost          $${last.usd.toFixed(4)}   →  $${(last.usd / calls.length * 3600).toFixed(2)} per hour at this rate`)

const failed = calls.filter((c) => c.status !== 200)
if (failed.length) console.log(`failed        ${failed.length} calls returned non-200`)

console.log(`\nfirst call, as the model saw it:`)
const f = calls[0]
for (const [k, v] of Object.entries(f.request.state)) console.log(`  ${k}: ${v}`)
console.log(`\n  one option: ${Object.values(f.request.questions[questions[0]].criteria)[0]}`)
const a0 = f.response?.answers?.[questions[0]]
if (a0) {
  const top = Object.entries(a0.probabilities ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 5)
  console.log(`\n  "${questions[0]}" chose ${a0.choice} at confidence ${a0.confidence}`)
  console.log(`  top probabilities: ${top.map(([k, v]) => `${k}=${v.toFixed(2)}`).join('  ')}`)
}
console.log('')

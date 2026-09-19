// Minimal JEV client. Deliberately defensive about the response shape —
// the API is a week old and we verify the field names against a live call.

const ENDPOINT = () => process.env.JEV_ENDPOINT || 'https://api.typesafe.ai/v1/systemone'
const MODEL = () => process.env.JEV_MODEL || 'jev-latest'

export async function ask({ state, questions, key = process.env.TYPESAFE_API_KEY, signal }) {
  if (!key) throw new Error('No TYPESAFE_API_KEY. Put it in .env')
  const t0 = performance.now()
  const res = await fetch(ENDPOINT(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ state, model: MODEL(), questions }),
    signal,
  })
  const ms = Math.round(performance.now() - t0)
  const text = await res.text()
  if (!res.ok) throw new Error(`JEV ${res.status}: ${text.slice(0, 500)}`)
  let json
  try { json = JSON.parse(text) } catch { throw new Error(`JEV returned non-JSON: ${text.slice(0, 300)}`) }
  return { raw: json, ms }
}

// Pull a choice answer out without assuming too much about nesting.
export function readChoice(raw, name) {
  const a = raw?.answers?.[name] ?? raw?.[name]
  if (!a) return null
  const picked = a.choice ?? a.value ?? a.answer ?? a.key
  const probabilities = a.probabilities ?? a.probs ?? a.distribution ?? {}
  return { picked, probabilities, confidence: a.confidence ?? null }
}

export function readScore(raw, name) {
  const a = raw?.answers?.[name] ?? raw?.[name]
  if (!a) return null
  return { score: a.score ?? a.value ?? null, confidence: a.confidence ?? null, legend: a.legend ?? null }
}

export function readNoul(raw, name) {
  const a = raw?.answers?.[name] ?? raw?.[name]
  if (!a) return null
  return { p: a.noul ?? a.probability ?? a.value ?? null, confidence: a.confidence ?? null }
}

/** Replay frozen model requests against the configured owner model; tool calls are recorded, never executed. */
import fs from 'node:fs'
import { sessionPromptContent } from '../../Server/src/modules/sessions/turn/session-prompt.ts'
import { selfAwakeInstruction } from '../../Server/src/model-prompts/self-awake.ts'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { monServiceConfig } from '../../Server/src/bootstrap/mon-service-config.ts'
import { MonClient, acquireMonServiceToken } from '../../packages/integrations/src/index.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const [sessionId, output, mode] = process.argv.slice(2)
if (!sessionId || !output) throw new Error('Usage: node --import tsx Script/Analysis/compare_character_identity.mjs SESSION_ID OUTPUT_JSON [label_only]')
const realm = path.join(root, 'Data/realms/mon/v2')
let db
for (const account of fs.readdirSync(path.join(realm, 'accounts'))) {
  const filename = path.join(realm, 'accounts', account, 'storage/eden-agent.db')
  if (!fs.existsSync(filename)) continue
  const candidate = new DatabaseSync(filename, { readOnly: true })
  if (candidate.prepare('SELECT 1 FROM sessions WHERE id=?').get(sessionId)) { db = candidate; break }
  candidate.close()
}
if (!db) throw new Error('Source session not found')
function restore(raw) {
  const record = JSON.parse(raw)
  for (const ref of record.requestStorage?.references ?? []) {
    const content = db.prepare('SELECT content_json FROM request_contents WHERE hash=?').get(ref.hash)?.content_json
    if (!content || createHash('sha256').update(content).digest('hex') !== ref.hash) throw new Error('Missing or corrupt request content')
    let target = record
    for (const key of ref.path.slice(0, -1)) target = target[key]
    target[ref.path.at(-1)] = JSON.parse(content)
  }
  return record.payload
}
const rows = db.prepare("SELECT seq,payload_json FROM events WHERE session_id=? AND kind='model.request' ORDER BY seq").all(sessionId)
if (rows.length < 2) throw new Error('Need opening and final model requests')
const probes = [{ name: 'opening', row: rows[0] }, { name: 'after_context', row: rows[Math.min(3, rows.length - 1)] }].map(({ name, row }) => {
  const payload = restore(row.payload_json)
  const { stream_options, max_completion_tokens, ...body } = payload
  return { name, seq: Number(row.seq), body: { ...body, stream: false, max_tokens: 8192 },
    contextHash: createHash('sha256').update(JSON.stringify({ messages: body.messages, tools: body.tools })).digest('hex') }
})
db.close()
const config = monServiceConfig('mon', realm, process.env)
const identity = { secret: config.env.MON_SERVICE_SHARED_SECRET, userId: config.env.MON_SERVICE_USER_ID, coreBaseUrl: config.env.MON_CORE_BASE_URL }
const signal = AbortSignal.timeout(30000)
const token = await acquireMonServiceToken(identity, signal)
const client = new MonClient(identity.coreBaseUrl, token)
const assistant = await client.get('/api/assistants/current/', signal)
const entity = await client.get(`/api/ai/entities/${assistant.character.ai_talk_entity_id}/`, signal)
if (entity.ai_model !== probes[0].body.model) throw new Error('Current model differs from recorded model')
const endpoint = entity.api_endpoint.replace(/\/$/, '') + '/chat/completions'
const groups = ['label_only', 'retry_label_tail'].includes(mode) ? [{ name: 'label_only', identity: false, wake: false, label: true }] : [
  { name: 'baseline', identity: false, wake: false },
  { name: 'identity_only', identity: true, wake: false },
  { name: 'wake_only', identity: false, wake: true },
  { name: 'combined', identity: true, wake: true },
]
function transform(probe, group) {
  const body = structuredClone(probe.body)
  const system = body.messages.find(m => m.role === 'system')
  const boundary = system.content.indexOf('\n{'), end = system.content.indexOf('\n', boundary + 1)
  if (boundary < 0) throw new Error('Expected recorded host header and JSON context')
  const serialized = system.content.slice(boundary + 1, end < 0 ? undefined : end)
  const context = JSON.parse(serialized)
  if (group.label) system.content = system.content.replace('你是 Eden Agent。\n', '')
  if (group.identity) system.content = sessionPromptContent(context).prompt + (end < 0 ? '' : system.content.slice(end))
  const message = body.messages.find(m => m.role === 'user')
  const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content
  const block = blocks.find(b => b.type === 'text' && b.text.includes('请求数据：\n'))
  if (!block) throw new Error('Missing recorded self-awake input')
  const request = JSON.parse(block.text.split('请求数据：\n')[1])
  if (group.wake) block.text = selfAwakeInstruction(request)
  if (typeof message.content === 'string') message.content = blocks[0].text
  body.max_tokens = 4096
  return { body, factsHash: createHash('sha256').update(JSON.stringify({ context, request, tools: body.tools,
    history: body.messages.slice(2) })).digest('hex') }
}
const report = { sourceSessionId: sessionId, model: entity.ai_model, startedAt: new Date().toISOString(),
  conditions: groups.map(group => group.name), mode: mode ?? 'factorial',
  method: 'Paired identity/wake ablation at frozen decision points. Same model, sampling, context facts, history and tool schemas. Calls recorded only; tools never executed.',
  probes: probes.map(({ body, ...meta }) => meta), results: [] }
const persist = () => fs.writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 })
persist()
for (let sample = 1; sample <= 2; sample++) {
  for (const probe of probes) {
    if (mode === 'retry_label_tail' && (sample !== 2 || probe.name !== 'after_context')) continue
    const variants = groups.map(group => ({ group, ...transform(probe, group) }))
    if (new Set(variants.map(v => v.factsHash)).size !== 1) throw new Error('Ablation altered control facts')
    const outcomes = await Promise.allSettled((sample === 1 ? variants : [...variants].reverse()).map(async ({ group, body, factsHash }) => {
      const started = Date.now()
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${entity.api_key}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(180000) })
      const data = await response.json(), choice = data.choices?.[0], message = choice?.message
      if (!response.ok || !message) throw new Error(data.error?.message ?? `Provider status ${response.status}`)
      const result = { probe: probe.name, group: group.name, sample, factsHash, elapsedMs: Date.now() - started,
        httpStatus: response.status, returnedModel: data.model, finishReason: choice.finish_reason,
        content: message.content ?? '', toolCalls: message.tool_calls ?? [], usage: data.usage }
      report.results.push(result); persist()
      console.log(JSON.stringify({ probe: result.probe, group: result.group, sample, finishReason: result.finishReason,
        characters: result.content.length, tools: result.toolCalls.map(t => t.function.name) }))
    }))
    for (const outcome of outcomes) if (outcome.status === 'rejected') {
      report.results.push({ probe: probe.name, sample, error: String(outcome.reason) }); persist()
    }
  }
}
report.completedAt = new Date().toISOString()
report.success = report.results.length === (mode === 'retry_label_tail' ? 1 : groups.length * probes.length * 2) && report.results.every(r => !r.error && ['stop', 'tool_calls'].includes(r.finishReason))
persist()
if (!report.success) process.exitCode = 1

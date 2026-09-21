/** Replay frozen model requests against the configured owner model; tool calls are recorded, never executed. */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { monServiceConfig } from '../../Server/src/bootstrap/mon-service-config.ts'
import { MonClient, acquireMonServiceToken } from '../../packages/integrations/src/index.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const [sessionId, output] = process.argv.slice(2)
if (!sessionId || !output) throw new Error('Usage: node --import tsx Script/Analysis/compare_self_awake_sampling.mjs SESSION_ID OUTPUT_JSON')
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
const probes = [{ name: 'opening', row: rows[0] }, { name: 'diary', row: rows.at(-1) }].map(({ name, row }) => {
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
const groups = [
  { name: 'thinking_high', params: { thinking: { type: 'enabled' }, reasoning_effort: 'high' } },
  { name: 'thinking_low', params: { thinking: { type: 'enabled' }, reasoning_effort: 'low' } },
  { name: 'off_temperature_06', params: { thinking: { type: 'disabled' }, temperature: 0.6 } },
  { name: 'off_temperature_10', params: { thinking: { type: 'disabled' }, temperature: 1.0 } },
]
const report = { sourceSessionId: sessionId, model: entity.ai_model, startedAt: new Date().toISOString(),
  method: 'Two paired comparisons; two samples per probe and group; same frozen messages/tools; no tool execution.',
  probes: probes.map(({ body, ...metadata }) => metadata), results: [] }
const persist = () => fs.writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 })
persist()
for (let sample = 1; sample <= 2; sample++) {
  for (const probe of probes) {
    // Alternate group order across samples to reduce simple time/order confounding.
    for (const group of sample === 1 ? groups : [...groups].reverse()) {
      const body = structuredClone(probe.body)
      for (const key of ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'thinking', 'reasoning_effort']) delete body[key]
      Object.assign(body, group.params)
      const started = Date.now()
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${entity.api_key}` },
          body: JSON.stringify(body), signal: AbortSignal.timeout(180000) })
        const result = await response.json(), choice = result.choices?.[0], message = choice?.message
        const item = { probe: probe.name, group: group.name, sample, contextHash: probe.contextHash, parameters: group.params,
          httpStatus: response.status, elapsedMs: Date.now() - started, returnedModel: result.model, finishReason: choice?.finish_reason,
          usage: result.usage, content: message?.content ?? '', toolCalls: message?.tool_calls ?? [],
          reasoningCharacters: message?.reasoning_content?.length ?? 0,
          ...(response.ok ? {} : { error: result.error?.message ?? 'Provider request failed' }) }
        report.results.push(item); persist()
        console.log(JSON.stringify({ probe: item.probe, group: item.group, sample, httpStatus: item.httpStatus,
          elapsedMs: item.elapsedMs, finishReason: item.finishReason, characters: item.content.length,
          tools: item.toolCalls.map(t => t.function?.name) }))
      } catch (error) {
        report.results.push({ probe: probe.name, group: group.name, sample, contextHash: probe.contextHash, error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started }); persist()
        console.log(JSON.stringify({ probe: probe.name, group: group.name, sample, failed: true }))
      }
    }
  }
}
report.completedAt = new Date().toISOString(); persist()

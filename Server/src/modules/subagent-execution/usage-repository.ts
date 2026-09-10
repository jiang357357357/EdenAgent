import type { EdenDatabase } from '@eden/store'
import type { JsonValue } from '@eden/api'

function object(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}
function count(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Record the completed response even when it exhausts a limit; later admissions stop. */
export function recordSubagentUsage(database: EdenDatabase, sessionId: string, turnId: string, messageId: string, payload: JsonValue): void {
  if (!database.inTransaction) throw new Error('Usage recording requires an owning transaction')
  const value = object(payload), message = object(value.message)
  if (message.role !== 'assistant') return
  const db = database.connection
  let row = db.prepare('SELECT * FROM subagent_threads WHERE child_session_id=?').get(sessionId)
  if (!row || db.prepare('SELECT 1 FROM subagent_usage_receipts WHERE turn_id=? AND message_id=?').get(turnId, messageId)) return
  const { tokens, microusd } = responseUsage(message, value)
  db.prepare('INSERT INTO subagent_usage_receipts VALUES(?,?,?,?,?,?)').run(turnId, messageId, row.id!, tokens, microusd, Date.now())
  const seen = new Set<string>()
  while (row) {
    const id = String(row.id)
    if (seen.has(id) || seen.size >= 4) throw new Error('Invalid subagent usage ancestry')
    seen.add(id)
    const totalTokens = Number(row.tokens_used) + (tokens ?? 0), totalCost = Number(row.cost_microusd_used) + (microusd ?? 0)
    if (!Number.isSafeInteger(totalTokens) || !Number.isSafeInteger(totalCost)) throw new Error('Subagent usage exceeds exact accounting range')
    db.prepare(`UPDATE subagent_threads SET tokens_used=?,cost_microusd_used=?,usage_unknown=MAX(usage_unknown,?),
      cost_unknown=MAX(cost_unknown,?),updated_at=? WHERE id=?`).run(totalTokens, totalCost, Number(tokens === null), Number(microusd === null), Date.now(), id)
    if (row.parent_id == null) break
    row = db.prepare('SELECT * FROM subagent_threads WHERE id=?').get(row.parent_id)
    if (!row) throw new Error('Subagent usage ancestor is missing')
  }
}

function responseUsage(message: Record<string, JsonValue>, value: Record<string, JsonValue>) {
  const usage = object(message.usage), tokens = count(usage.totalTokens), cost = object(usage.cost)
  const dollars = typeof cost.total === 'number' && Number.isFinite(cost.total) && cost.total >= 0 ? cost.total : null
  const microusd = value.costConfigured === true ? count(usage.costMicrousd) ?? (dollars === null ? null : count(Math.ceil(dollars * 1000000))) : null
  return { tokens, microusd }
}

export function recordSubagentResponse(database: EdenDatabase, sessionId: string, turnId: string, payload: JsonValue): void {
  if (!database.inTransaction) throw new Error('Response recording requires an owning transaction')
  const value = object(payload), db = database.connection
  if (!db.prepare('SELECT 1 FROM subagent_threads WHERE child_session_id=?').get(sessionId)) return
  if (typeof value.requestId !== 'string') throw new Error('Model response has no correlation ID')
  const row = db.prepare('SELECT * FROM subagent_model_requests WHERE id=? AND session_id=? AND turn_id=?').get(value.requestId, sessionId, turnId)
  if (!row) throw new Error('Model response request ownership mismatch')
  if (row.state !== 'pending') return
  const message = object(value.message), usage = object(message.usage)
  // Error/abort zero defaults do not prove that the provider performed no work.
  const unknown = ['error', 'aborted'].includes(String(message.stopReason)) && usage.totalTokens === 0
  recordSubagentUsage(database, sessionId, turnId, value.requestId, {
    ...value, costConfigured: row.cost_configured === 1,
    message: unknown ? { ...message, usage: null } : message
  })
  db.prepare("UPDATE subagent_model_requests SET state='responded',resolved_at=? WHERE id=?").run(Date.now(), value.requestId)
}

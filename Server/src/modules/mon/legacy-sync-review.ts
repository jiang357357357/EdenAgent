import { monLegacySyncResolveSchema } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'
export function resolveLegacySync(sessions: SessionRepository, raw: unknown) {
  const input = monLegacySyncResolveSchema.parse(raw)
  if (sessions.read(input.sessionId).runtimeOrigin !== 'mon') throw new Error('Historical Core delivery review requires Mon')
  const result = sessions.database.transaction(() => {
    const db = sessions.database.connection
    const row = db.prepare('SELECT state FROM legacy_core_outbox WHERE id=? AND session_id=?').get(input.id, input.sessionId)
    if (!row) throw new Error('Historical Core delivery not found in this session')
    const prior = db.prepare('SELECT decision,note FROM legacy_core_delivery_reviews WHERE delivery_id=?').get(input.id)
    if (prior) {
      if (prior.decision !== input.decision || prior.note !== input.note) throw new Error('Historical delivery has already been reviewed differently')
      return { value: { id: input.id, state: String(row.state), decision: input.decision } }
    }
    if (!['held', 'unknown'].includes(String(row.state))) throw new Error('Historical delivery is not awaiting review')
    const state = input.decision === 'confirm_completed' ? 'completed' : 'abandoned', now = Date.now()
    const changed = db.prepare('UPDATE legacy_core_outbox SET state=? WHERE id=? AND session_id=? AND state=?').run(state, input.id, input.sessionId, row.state!)
    if (changed.changes !== 1) throw new Error('Historical delivery changed before review')
    db.prepare('INSERT INTO legacy_core_delivery_reviews(delivery_id,decision,note,previous_state,created_at) VALUES(?,?,?,?,?)')
      .run(input.id, input.decision, input.note, row.state!, now)
    const event = sessions.events.insert(input.sessionId, null, 'mon.legacy_delivery.reviewed', {
      id: input.id, decision: input.decision, previousState: String(row.state), state, note: input.note })
    return { value: { id: input.id, state, decision: input.decision }, event }
  })
  if (result.event) sessions.events.publish(result.event)
  return result.value
}

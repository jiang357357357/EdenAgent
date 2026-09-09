import { selfAwakeDecisionSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'

export class SelfAwakeActionRepository {
  constructor(private readonly sessions: SessionRepository) {}
  recover(): void {
    this.sessions.database.connection.prepare("UPDATE self_awake_runs SET state='action_interrupted',last_error='Action interrupted; review before resuming',updated_at=? WHERE state='action_running'").run(Date.now())
  }
  claim() {
    return this.sessions.database.transaction(() => {
      const row = this.sessions.database.connection.prepare("SELECT * FROM self_awake_runs WHERE state='awaiting_action' ORDER BY created_at LIMIT 1").get()
      if (!row) return undefined
      this.sessions.database.connection.prepare("UPDATE self_awake_runs SET state='action_running',updated_at=? WHERE id=?").run(Date.now(), row.id!)
      return { id: String(row.id), sessionId: String(row.session_id), turnId: String(row.turn_id),
        decision: selfAwakeDecisionSchema.parse(JSON.parse(String(row.decision_json))), author: JSON.parse(String(row.author_json)) as JsonValue }
    })
  }
  finish(id: string, result: JsonValue, error?: string): void {
    const events = this.sessions.database.transaction(() => {
      const row = this.sessions.database.connection.prepare('SELECT session_id,turn_id,decision_json FROM self_awake_runs WHERE id=?').get(id)
      if (!row) throw new Error('Self-awake action not found')
      const update = this.sessions.database.connection.prepare("UPDATE self_awake_runs SET state=?,action_result_json=?,last_error=?,updated_at=? WHERE id=? AND state='action_running'")
        .run(error ? 'action_failed' : 'completed', JSON.stringify(result), error ?? null, Date.now(), id)
      if (update.changes !== 1) throw new Error('Self-awake action is no longer owned')
      const recorded = []
      const decision = selfAwakeDecisionSchema.parse(JSON.parse(String(row.decision_json)))
      if (!error && ['run_safe_check', 'sync_context'].includes(decision.action)) {
        recorded.push(this.sessions.events.insert(String(row.session_id), row.turn_id === null ? null : String(row.turn_id),
          decision.action === 'run_safe_check' ? 'self_awake.safe_check' : 'self_awake.sync_context',
          { runId: id, status: 'requested', scope: 'local_runtime', note: 'Decision marker only; actual operations are recorded as approved tool executions.' }))
      }
      recorded.push(this.sessions.events.insert(String(row.session_id), row.turn_id === null ? null : String(row.turn_id), 'self_awake.action_applied', toJson({ runId: id, result, status: error ? 'failed' : 'persisted', error: error ?? null })))
      return recorded
    })
    for (const event of events) this.sessions.events.publish(event)
  }
  resume(id: string): void {
    const event = this.sessions.database.transaction(() => {
      const row = this.sessions.database.connection.prepare('SELECT state,session_id,turn_id FROM self_awake_runs WHERE id=?').get(id)
      if (!row || !['action_failed', 'action_interrupted'].includes(String(row.state))) throw new Error('Self-awake action cannot be resumed')
      if (this.sessions.read(String(row.session_id)).status !== 'active') throw new Error('Self-awake session is not active')
      const changed = this.sessions.database.connection.prepare("UPDATE self_awake_runs SET state='awaiting_action',last_error=NULL,updated_at=? WHERE id=? AND state=?")
        .run(Date.now(), id, row.state!)
      if (changed.changes !== 1) throw new Error('Self-awake action changed before resume')
      return this.sessions.events.insert(String(row.session_id), row.turn_id === null ? null : String(row.turn_id),
        'self_awake.action_resumed', { runId: id, previousState: String(row.state), state: 'awaiting_action' })
    })
    this.sessions.events.publish(event)
  }
}

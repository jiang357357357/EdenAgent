import { createHash } from 'node:crypto'
import type { SessionRepository } from '../session-repository.ts'
const fingerprint = (row: object) => createHash('sha256').update(JSON.stringify(row)).digest('hex')

export class InputRecoveryRepository {
  constructor(private readonly sessions: SessionRepository) {}
  list(sessionId: string, after = '', includeCancelled = false) {
    this.sessions.read(sessionId)
    const rows = this.sessions.database.connection.prepare(`SELECT * FROM inputs WHERE session_id=? AND id>?
      AND (state IN ('held','interrupted') OR (? AND state='cancelled')) ORDER BY id LIMIT 51`).all(sessionId, after, Number(includeCancelled))
    const visible = rows.slice(0, 50)
    return { items: visible.map(row => ({ id: String(row.id), turnId: String(row.turn_id), state: String(row.state), kind: String(row.kind),
      text: String(row.text).slice(0, 32000), truncated: String(row.text).length > 32000, fingerprint: fingerprint(row), createdAt: Number(row.created_at) })),
      nextCursor: rows.length > 50 ? String(visible.at(-1)!.id) : null }
  }
  resolve(sessionId: string, id: string, expected: string, decision: 'completed' | 'cancelled', note: string) {
    this.sessions.read(sessionId)
    const event = this.sessions.database.transaction(() => {
      const db = this.sessions.database.connection
      const input = db.prepare('SELECT * FROM inputs WHERE id=? AND session_id=?').get(id, sessionId)
      if (!input) throw new Error('Input not found in this session')
      const old = db.prepare('SELECT * FROM input_outcome_reviews WHERE input_id=?').get(id)
      if (old) {
        if (old.fingerprint !== expected || old.decision !== decision || old.note !== note) throw new Error('Input outcome already reviewed with different evidence')
        return undefined
      }
      if (!['held','interrupted'].includes(String(input.state)) || fingerprint(input) !== expected) throw new Error('Input changed; reload before reviewing')
      const turn = db.prepare('SELECT state FROM turns WHERE id=? AND session_id=?').get(input.turn_id!, sessionId)
      if (turn?.state === 'running') throw new Error('Wait for the original turn to stop before reviewing')
      if (decision === 'completed') {
        if (!turn || input.state !== 'interrupted' || ['held', 'queued'].includes(String(turn.state))) throw new Error('An input without an execution attempt cannot be confirmed completed')
        if (db.prepare("SELECT 1 FROM tool_operations WHERE session_id=? AND turn_id=? AND state IN ('running','unknown') LIMIT 1").get(sessionId, input.turn_id!)) throw new Error('Reconcile unknown tool operations before confirming completion')
      }
      db.prepare('INSERT INTO input_outcome_reviews VALUES(?,?,?,?,?,?)').run(id, expected, input.state!, decision, note, Date.now())
      db.prepare('UPDATE inputs SET state=? WHERE id=?').run(decision, id)
      db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(Date.now(), sessionId)
      // Keep the original turn state/error intact. User adjudication is a separate durable event.
      return this.sessions.events.insert(sessionId, String(input.turn_id), 'input.outcome_reviewed', { inputId: id, previousState: String(input.state), decision, note })
    })
    if (event) this.sessions.events.publish(event)
    return { id, state: decision }
  }
}

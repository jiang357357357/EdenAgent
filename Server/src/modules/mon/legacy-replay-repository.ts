import { createHash } from 'node:crypto'
import { toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'
export interface LegacyReplayRequest { sessionId: string; id: number; requestKey: string; note: string }
export class LegacyReplayRepository {
  constructor(private readonly sessions: SessionRepository) {}
  recover(): void {
    this.sessions.database.transaction(() => {
      const db = this.sessions.database.connection
      db.prepare("UPDATE legacy_core_outbox SET state='unknown' WHERE id IN (SELECT delivery_id FROM legacy_core_replays WHERE state='running') AND state='running'").run()
      db.prepare("UPDATE legacy_core_replays SET state='unknown',error='Host stopped before replay confirmation',updated_at=? WHERE state='running'").run(Date.now())
    })
  }
  read(key: string) {
    const row = this.sessions.database.connection.prepare('SELECT * FROM legacy_core_replays WHERE request_key=?').get(key)
    if (!row) throw new Error('Historical replay request was not found')
    return { requestKey: String(row.request_key), id: Number(row.delivery_id), sessionId: String(row.session_id), state: String(row.state),
      note: String(row.note), result: row.result_json === null ? null : toJson(JSON.parse(String(row.result_json))),
      error: row.error === null ? null : String(row.error), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }
  }
  begin(input: LegacyReplayRequest, payload: string): { fresh: boolean; replay: ReturnType<LegacyReplayRepository['read']> } {
    if (this.sessions.read(input.sessionId).runtimeOrigin !== 'mon') throw new Error('Historical replay requires Mon')
    const hash = createHash('sha256').update(payload).digest('hex')
    const outcome = this.sessions.database.transaction(() => {
      const db = this.sessions.database.connection
      const old = db.prepare('SELECT * FROM legacy_core_replays WHERE request_key=?').get(input.requestKey)
      if (old) {
        if (old.session_id !== input.sessionId || Number(old.delivery_id) !== input.id || old.note !== input.note || old.payload_hash !== hash) throw new Error('Replay key was used with another request')
        return { fresh: false }
      }
      const row = db.prepare('SELECT state,payload_json FROM legacy_core_outbox WHERE id=? AND session_id=?').get(input.id, input.sessionId)
      if (!row || !['held', 'unknown'].includes(String(row.state)) || row.payload_json !== payload) throw new Error('Historical delivery is not available for replay')
      if (db.prepare('SELECT 1 FROM legacy_core_delivery_reviews WHERE delivery_id=?').get(input.id)) throw new Error('Reviewed delivery cannot be replayed')
      const now = Date.now()
      db.prepare("INSERT INTO legacy_core_replays(request_key,delivery_id,session_id,note,payload_hash,state,created_at,updated_at) VALUES(?,?,?,?,?,'running',?,?)")
        .run(input.requestKey, input.id, input.sessionId, input.note, hash, now, now)
      db.prepare("UPDATE legacy_core_outbox SET state='running',attempts=attempts+1 WHERE id=?").run(input.id)
      return { fresh: true, event: this.sessions.events.insert(input.sessionId, null, 'mon.legacy_replay.started', { id: input.id, requestKey: input.requestKey, note: input.note }) }
    })
    if (outcome.event) this.sessions.events.publish(outcome.event)
    return { fresh: outcome.fresh, replay: this.read(input.requestKey) }
  }
  assertRunning(key: string): void {
    const row = this.sessions.database.connection.prepare(`SELECT 1 FROM legacy_core_replays r JOIN legacy_core_outbox o ON o.id=r.delivery_id
      WHERE r.request_key=? AND r.state='running' AND o.state='running'`).get(key)
    if (!row) throw new Error('Historical replay is no longer active')
  }
  finish(key: string, result: JsonValue | null, error?: string) {
    const event = this.sessions.database.transaction(() => {
      this.assertRunning(key)
      const replay = this.read(key), now = Date.now(), state = error ? 'unknown' : 'completed'
      this.sessions.database.connection.prepare('UPDATE legacy_core_replays SET state=?,result_json=?,error=?,updated_at=? WHERE request_key=?')
        .run(state, result === null ? null : JSON.stringify(result), error ?? null, now, key)
      this.sessions.database.connection.prepare('UPDATE legacy_core_outbox SET state=? WHERE id=?').run(state, replay.id)
      return this.sessions.events.insert(replay.sessionId, null, 'mon.legacy_replay.finished', { id: replay.id, requestKey: key, state, error: error ?? null })
    })
    this.sessions.events.publish(event)
    return this.read(key)
  }
}

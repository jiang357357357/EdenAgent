import { randomUUID } from 'node:crypto'
import { toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'
export class MediaRepository {
  constructor(readonly sessions: SessionRepository) {}
  read(id: string) {
    const row = this.sessions.database.connection.prepare('SELECT * FROM media_requests WHERE id=?').get(id)
    if (!row) throw new Error('Media request not found')
    return { id: String(row.id), sessionId: String(row.session_id), turnId: String(row.turn_id), kind: String(row.kind),
      state: String(row.state), request: JSON.parse(String(row.request_json)) as JsonValue, createdAt: Number(row.created_at) }
  }
  list(kind?: string | null) {
    return this.sessions.database.connection.prepare("SELECT m.id FROM media_requests m JOIN sessions s ON s.id=m.session_id WHERE m.state='pending' AND s.status='active' AND (? IS NULL OR m.kind=?) ORDER BY m.created_at,m.id")
      .all(kind ?? null, kind ?? null).map(row => this.read(String(row.id)))
  }
  create(sessionId: string, turnId: string, kind: string, request: JsonValue) {
    if (this.sessions.read(sessionId).status !== 'active') throw new Error('Media capture requires an active session')
    const id = randomUUID()
    const event = this.sessions.database.transaction(() => {
      const count = this.sessions.database.connection.prepare("SELECT COUNT(*) AS n FROM media_requests WHERE state='pending'").get()
      if (Number(count?.n) >= 32) throw new Error('Media request capacity reached')
      this.sessions.database.connection.prepare("INSERT INTO media_requests VALUES(?,?,?,?,'pending',?,NULL,NULL,?,NULL)")
        .run(id, sessionId, turnId, kind, JSON.stringify(request), Date.now())
      return this.sessions.events.insert(sessionId, turnId, 'media.requested', toJson(this.read(id)))
    })
    return { request: this.read(id), event }
  }
  finish(id: string, state: string, result: JsonValue | null = null, error: string | null = null) {
    const event = this.sessions.database.transaction(() => {
      const request = this.read(id)
      if (request.state !== 'pending') throw new Error('Media request is no longer pending')
      this.sessions.database.connection.prepare('UPDATE media_requests SET state=?,result_json=?,error=?,resolved_at=? WHERE id=?')
        .run(state, result === null ? null : JSON.stringify(result), error, Date.now(), id)
      return this.sessions.events.insert(request.sessionId, request.turnId, 'media.resolved', { id, state, result, error })
    })
    this.sessions.events.publish(event)
    return this.read(id)
  }
}

import { randomUUID } from 'node:crypto'
import type { JsonValue, MonOperationQuery } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'

export class MonOperationRepository {
  constructor(private readonly sessions: SessionRepository) {
    const rows = sessions.database.connection.prepare("SELECT id FROM mon_operations WHERE state='running'").all()
    for (const row of rows) this.finish(String(row.id), 'unknown', 'Host restarted before confirming the Mon response')
  }

  list(query: MonOperationQuery): JsonValue[] {
    const rows = this.sessions.database.connection.prepare(`
      SELECT * FROM mon_operations
      WHERE (? IS NULL OR session_id=?) AND (? IS NULL OR state=?)
      ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(query.sessionId ?? null, query.sessionId ?? null, query.state ?? null, query.state ?? null, query.limit)
    return rows.map(row => ({
      operationId: String(row.id), sessionId: row.session_id === null ? null : String(row.session_id),
      kind: String(row.kind), endpoint: String(row.endpoint), request: JSON.parse(String(row.request_json)) as JsonValue,
      state: String(row.state), error: row.error === null ? null : String(row.error),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    }))
  }

  begin(sessionId: string | undefined, endpoint: string, request: JsonValue, kind = 'model.select'): string {
    const id = randomUUID()
    const event = this.sessions.database.transaction(() => {
      const now = Date.now()
      this.sessions.database.connection.prepare('INSERT INTO mon_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, sessionId ?? null, kind, endpoint, JSON.stringify(request), 'running', null, now, now)
      return sessionId ? this.sessions.events.insert(sessionId, null, 'mon.operation.started', { operationId: id, kind, endpoint, request }) : undefined
    })
    if (event) this.sessions.events.publish(event)
    return id
  }

  finish(id: string, state: 'applied' | 'unknown' | 'failed', error: string | null = null): void {
    const event = this.sessions.database.transaction(() => {
      const row = this.sessions.database.connection.prepare('SELECT session_id FROM mon_operations WHERE id=?').get(id)
      if (!row) throw new Error('Mon operation not found')
      this.sessions.database.connection.prepare('UPDATE mon_operations SET state=?, error=?, updated_at=? WHERE id=?').run(state, error, Date.now(), id)
      return row.session_id ? this.sessions.events.insert(String(row.session_id), null, 'mon.operation.completed', { operationId: id, state, error }) : undefined
    })
    if (event) this.sessions.events.publish(event)
  }
}

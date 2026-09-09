import { legacySyncStatus } from './legacy-sync-status.ts'
import { monSyncStatusSchema } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'
export class MonSyncStatus {
  constructor(private readonly sessions: SessionRepository) {}
  read(raw: unknown) {
    const input = monSyncStatusSchema.parse(raw)
    if (this.sessions.read(input.sessionId).runtimeOrigin !== 'mon') throw new Error('Mon synchronization is only available in Mon')
    const db = this.sessions.database.connection
    const totals = db.prepare('SELECT state,COUNT(*) AS count FROM mon_projection_outbox WHERE session_id=? GROUP BY state').all(input.sessionId)
    const progress = db.prepare('SELECT after_seq,attempts,retry_at,error FROM mon_sync_progress WHERE session_id=?').all(input.sessionId)
    const rows = db.prepare(`SELECT rowid AS cursor,id,kind,state,remote_id,error,created_at,updated_at FROM mon_projection_outbox
      WHERE session_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?`).all(input.sessionId, input.before ?? Number.MAX_SAFE_INTEGER, input.limit + 1)
    const items = rows.slice(0, input.limit).map(row => ({ id: String(row.id), kind: String(row.kind), state: String(row.state),
      remoteId: row.remote_id === null ? null : String(row.remote_id), error: row.error === null ? null : String(row.error),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }))
    const contacts = db.prepare('SELECT request_id,channel,state,error,updated_at FROM mon_contact_deliveries WHERE session_id=? ORDER BY updated_at DESC LIMIT 30')
      .all(input.sessionId).map(row => ({ requestId: String(row.request_id), channel: String(row.channel), state: String(row.state),
        error: row.error === null ? null : String(row.error), updatedAt: Number(row.updated_at) }))
    return { legacy: legacySyncStatus(this.sessions.database, input.sessionId, input.legacyBefore, input.limit), contacts, bound: Boolean(db.prepare('SELECT 1 FROM mon_connections WHERE session_id=?').get(input.sessionId)),
      totals: Object.fromEntries(totals.map(row => [String(row.state), Number(row.count)])),
      progress: progress.map(row => ({ afterSeq: String(row.after_seq), attempts: Number(row.attempts), retryAt: Number(row.retry_at), error: row.error === null ? null : String(row.error) })),
      items, nextCursor: rows.length > input.limit ? Number(rows[input.limit - 1]!.cursor) : null }
  }
}

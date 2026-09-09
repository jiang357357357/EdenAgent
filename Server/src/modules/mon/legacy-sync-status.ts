import type { EdenDatabase } from '@eden/store'
export function legacySyncStatus(database: EdenDatabase, sessionId: string, before: number | undefined, limit: number) {
  const db = database.connection
  const identity = db.prepare('SELECT state FROM legacy_core_identities WHERE session_id=?').get(sessionId)
  const counts = db.prepare('SELECT state,COUNT(*) AS count FROM legacy_core_outbox WHERE session_id=? GROUP BY state').all(sessionId)
  const rows = db.prepare(`SELECT o.id,o.kind,o.state,o.attempts,o.last_error,o.created_at,o.updated_at,r.decision,r.note,r.created_at AS reviewed_at FROM legacy_core_outbox o
    LEFT JOIN legacy_core_delivery_reviews r ON r.delivery_id=o.id WHERE o.session_id=? AND o.id<? ORDER BY o.id DESC LIMIT ?`).all(sessionId, before ?? Number.MAX_SAFE_INTEGER, limit + 1)
  return { identityState: identity ? String(identity.state) : null,
    blocked: identity?.state === 'rebind_required' || counts.some(row => ['held', 'unknown', 'running'].includes(String(row.state)) && Number(row.count) > 0),
    totals: Object.fromEntries(counts.map(row => [String(row.state), Number(row.count)])),
    items: rows.slice(0, limit).map(row => ({ id: Number(row.id), kind: String(row.kind), state: String(row.state), attempts: Number(row.attempts),
      review: row.decision === null ? null : { decision: String(row.decision), note: String(row.note), createdAt: Number(row.reviewed_at) },
      error: row.last_error === null ? null : String(row.last_error), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) })),
    nextCursor: rows.length > limit ? Number(rows[limit - 1]!.id) : null }
}

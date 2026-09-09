import type { EdenDatabase } from '@eden/store'
export function legacySyncStatus(database: EdenDatabase, sessionId: string, before: number | undefined, limit: number) {
  const db = database.connection
  const identity = db.prepare('SELECT state FROM legacy_core_identities WHERE session_id=?').get(sessionId)
  const counts = db.prepare('SELECT state,COUNT(*) AS count FROM legacy_core_outbox WHERE session_id=? GROUP BY state').all(sessionId)
  const rows = db.prepare(`SELECT o.id,o.kind,o.state,o.attempts,o.last_error,o.created_at,o.updated_at,r.decision,r.note,r.created_at AS reviewed_at,
    p.request_key AS replay_key,p.state AS replay_state,p.note AS replay_note,p.error AS replay_error,p.updated_at AS replay_updated_at FROM legacy_core_outbox o
    LEFT JOIN legacy_core_delivery_reviews r ON r.delivery_id=o.id
    LEFT JOIN legacy_core_replays p ON p.request_key=(SELECT request_key FROM legacy_core_replays WHERE delivery_id=o.id ORDER BY created_at DESC,rowid DESC LIMIT 1) WHERE o.session_id=? AND o.id<? ORDER BY o.id DESC LIMIT ?`).all(sessionId, before ?? Number.MAX_SAFE_INTEGER, limit + 1)
  return { identityState: identity ? String(identity.state) : null,
    blocked: identity?.state === 'rebind_required' || counts.some(row => ['held', 'unknown', 'running'].includes(String(row.state)) && Number(row.count) > 0),
    totals: Object.fromEntries(counts.map(row => [String(row.state), Number(row.count)])),
    items: rows.slice(0, limit).map(row => ({ id: Number(row.id), kind: String(row.kind), state: String(row.state), attempts: Number(row.attempts),
      replay: row.replay_key === null ? null : { requestKey: String(row.replay_key), state: String(row.replay_state), note: String(row.replay_note),
        error: row.replay_error === null ? null : String(row.replay_error), updatedAt: Number(row.replay_updated_at) },
      review: row.decision === null ? null : { decision: String(row.decision), note: String(row.note), createdAt: Number(row.reviewed_at) },
      error: row.last_error === null ? null : String(row.last_error), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) })),
    nextCursor: rows.length > limit ? Number(rows[limit - 1]!.id) : null }
}

import type { DatabaseSync } from 'node:sqlite'
import { legacyContextCheckpoint } from '@eden/runtime-pi'
import { toJson } from '@eden/api'
function history(db: DatabaseSync, sessionId: string) {
  const compact = db.prepare("SELECT id,CAST(seq AS TEXT) AS seq,payload_json FROM events WHERE session_id=? AND kind='context.compacted' ORDER BY seq DESC LIMIT 1").get(sessionId)
  const summary = compact ? JSON.parse(String(compact.payload_json)) : null
  const firstKept = summary && typeof summary.firstKeptEntryId === 'string' ? db.prepare('SELECT CAST(seq AS TEXT) AS seq FROM events WHERE session_id=? AND id=?').get(sessionId, summary.firstKeptEntryId) : undefined
  if (summary?.firstKeptEntryId && !firstKept) throw new Error('Historical compaction references an absent retained event')
  const start = firstKept ? BigInt(String(firstKept.seq)) : compact ? BigInt(String(compact.seq)) + 1n : 0n
  const result = compact ? [toJson({ kind: 'compaction', sourceEventId: String(compact.id), summary })] : []
  const statement = db.prepare(`SELECT e.id,e.kind,e.payload_json,e.created_at,CAST(e.seq AS TEXT) AS seq FROM events e
    WHERE e.session_id=? AND e.seq>=? AND (e.kind IN ('context.skill_snapshot','context.subagent_notification')
      OR (e.kind='agent.message_end' AND EXISTS(SELECT 1 FROM events done WHERE done.session_id=e.session_id AND done.turn_id=e.turn_id AND done.kind='turn.completed')))
    ORDER BY e.seq`)
  let bytes = 0
  for (const event of statement.iterate(sessionId, start)) {
    const payload = JSON.parse(String(event.payload_json))
    if (event.kind === 'agent.message_end' && (payload.message == null || payload.message.transient === true)) continue
    bytes += Buffer.byteLength(String(event.payload_json))
    if (bytes > 512 * 1024) throw new Error('Historical context requires explicit compaction before continuation')
    result.push(toJson({ sourceEventId: String(event.id), sequence: String(event.seq), kind: String(event.kind), createdAt: Number(event.created_at), payload }))
  }
  return result
}

/** Build initial checkpoints only; no existing or subsequently updated checkpoint is overwritten. */
export function convertLegacyContexts(db: DatabaseSync): void {
  let after = ''
  while (true) {
    const sessions = db.prepare(`SELECT s.id,s.created_at FROM sessions s JOIN legacy_conversion_ids i ON i.domain='sessions' AND i.target_id=s.id
      WHERE s.id>? AND NOT EXISTS(SELECT 1 FROM legacy_runtime_contexts c WHERE c.session_id=s.id AND c.state='prepared') ORDER BY s.id LIMIT 64`).all(after)
    if (!sessions.length) return
    for (const session of sessions) {
      const id = String(session.id)
      after = id
      let checkpoint: ReturnType<typeof legacyContextCheckpoint>
      try {
        const metadata = db.prepare("SELECT payload_json FROM events WHERE session_id=? AND kind='session.metadata.updated' ORDER BY seq DESC LIMIT 1").get(id)
        const participants = metadata ? JSON.parse(String(metadata.payload_json)).participants : []
        if (!Array.isArray(participants)) throw new Error('Historical session participants are invalid')
        if (participants.length > 1) throw new Error('Historical multi-actor context requires per-actor restoration')
        checkpoint = legacyContextCheckpoint(id, history(db, id), Number(session.created_at))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Historical context could not be restored'
        db.prepare("INSERT INTO legacy_runtime_contexts VALUES(?,'review_required',?,?) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state,error=excluded.error,updated_at=excluded.updated_at")
          .run(id, message.slice(0, 2000), Date.now())
        continue
      }
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('INSERT INTO runtime_checkpoints VALUES(?,?,?)').run(id, JSON.stringify(checkpoint), Date.now())
        db.prepare("INSERT INTO legacy_runtime_contexts VALUES(?,'prepared',NULL,?) ON CONFLICT(session_id) DO UPDATE SET state='prepared',error=NULL,updated_at=excluded.updated_at").run(id, Date.now())
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    }
  }
}

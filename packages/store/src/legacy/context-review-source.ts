import type { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { legacyContextActors } from './context-targets.ts'

export function contextReviewTarget(db: DatabaseSync, sessionId: string) {
  const session = db.prepare('SELECT id,created_at FROM sessions WHERE id=?').get(sessionId)
  const imported = db.prepare("SELECT 1 FROM legacy_conversion_ids WHERE target_id=? AND domain IN ('sessions','agent_child_sessions')").get(sessionId)
  if (!session || !imported) throw new Error('Historical session not found')
  const child = db.prepare(`SELECT c.* FROM legacy_subagent_context c JOIN subagent_threads t ON t.id=c.agent_id WHERE t.child_session_id=?`).get(sessionId)
  return { sessionId, createdAt: Number(session.created_at), child, actors: child ? [] : legacyContextActors(db, sessionId) }
}

/** Preserve source ordering and completion evidence. Configuration credentials are never exported. */
export function* contextReviewLines(db: DatabaseSync, sessionId: string): Generator<string> {
  const target = contextReviewTarget(db, sessionId)
  yield JSON.stringify({ format: 'eden.legacy-context-review.v1', sessionId, actors: target.actors, childAgentId: target.child ? String(target.child.agent_id) : null }) + '\n'
  if (target.child) {
    const row = target.child
    const config = JSON.parse(String(row.config_json))
    const context = row.context_json === null ? null : JSON.parse(String(row.context_json))
    yield JSON.stringify({ kind: 'historical_subagent_task', prompt: String(row.prompt), contextPresent: context !== null }) + '\n'
    const messages = context === null ? config.parentHistory ?? [] : context.messages
    if (!Array.isArray(messages)) throw new Error('Historical subagent messages are missing')
    for (const message of messages) yield JSON.stringify({ kind: 'historical_message', message }) + '\n'
    return
  }
  const rows = db.prepare(`SELECT e.id,e.kind,CAST(e.seq AS TEXT) AS seq,e.payload_json,e.created_at,
    EXISTS(SELECT 1 FROM events done WHERE done.session_id=e.session_id AND done.turn_id=e.turn_id AND done.kind='turn.completed') AS turn_completed
    FROM events e WHERE e.session_id=? AND e.kind IN ('agent.message_end','context.compacted','context.skill_snapshot','context.subagent_notification') ORDER BY e.seq`)
  for (const row of rows.iterate(sessionId)) yield JSON.stringify({ id: String(row.id), sequence: String(row.seq), kind: String(row.kind),
    createdAt: Number(row.created_at), turnCompleted: row.turn_completed === 1, payload: JSON.parse(String(row.payload_json)) }) + '\n'
}

export function contextReviewDigest(db: DatabaseSync, sessionId: string): string {
  const hash = createHash('sha256')
  for (const line of contextReviewLines(db, sessionId)) hash.update(line)
  return hash.digest('hex')
}

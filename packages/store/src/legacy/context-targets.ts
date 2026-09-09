import type { DatabaseSync } from 'node:sqlite'
import { actorIdSchema } from '@eden/api'

/** Old Rust actors received the shared transcript; new checkpoints diverge after import. */
export function legacyContextActors(db: DatabaseSync, sessionId: string): string[] {
  const metadata = db.prepare("SELECT payload_json FROM events WHERE session_id=? AND kind='session.metadata.updated' ORDER BY seq DESC LIMIT 1").get(sessionId)
  const participants: unknown = metadata ? JSON.parse(String(metadata.payload_json)).participants : []
  if (!Array.isArray(participants)) throw new Error('Historical session participants are invalid')
  const ids = participants.map(participant => {
    if (!participant || typeof participant !== 'object' || Array.isArray(participant)) throw new Error('Historical participant is invalid')
    return String(actorIdSchema.parse(participant.assistantId))
  })
  if (new Set(ids).size !== ids.length) throw new Error('Historical participants contain duplicate assistant identities')
  return ids
}

export function legacyContextPrepared(db: DatabaseSync, sessionId: string, actors: string[]): boolean {
  const state = db.prepare('SELECT state FROM legacy_runtime_contexts WHERE session_id=?').get(sessionId)
  if (state?.state !== 'prepared') return false
  if (!db.prepare('SELECT 1 FROM runtime_checkpoints WHERE session_id=?').get(sessionId)) return false
  return actors.every(id => !!db.prepare('SELECT 1 FROM actor_checkpoints WHERE session_id=? AND assistant_id=?').get(sessionId, id))
}

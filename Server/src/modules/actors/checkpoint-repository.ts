import { actorIdSchema, runtimeCheckpointSchema } from '@eden/api'
import type { RuntimeCheckpoint } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'

export class ActorCheckpointRepository {
  constructor(private readonly sessions: SessionRepository) {}

  read(sessionId: string, assistantId: string | number): RuntimeCheckpoint | undefined {
    this.sessions.assertContextReady(sessionId)
    const row = this.sessions.database.connection.prepare('SELECT checkpoint_json FROM actor_checkpoints WHERE session_id=? AND assistant_id=?')
      .get(sessionId, String(actorIdSchema.parse(assistantId)))
    return row ? runtimeCheckpointSchema.parse(JSON.parse(String(row.checkpoint_json))) : undefined
  }

  save(sessionId: string, assistantId: string | number, turnId: string, snapshot: RuntimeCheckpoint): void {
    this.sessions.read(sessionId)
    const id = String(actorIdSchema.parse(assistantId))
    const checkpoint = runtimeCheckpointSchema.parse(snapshot)
    if (checkpoint.sessionId !== sessionId) throw new Error('Actor checkpoint session mismatch')
    const event = this.sessions.database.transaction(() => {
      this.sessions.database.connection.prepare(`INSERT INTO actor_checkpoints VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id, assistant_id) DO UPDATE SET checkpoint_json=excluded.checkpoint_json, updated_at=excluded.updated_at`)
        .run(sessionId, id, JSON.stringify(checkpoint), Date.now())
      return this.sessions.events.insert(sessionId, turnId, 'actor.checkpoint', { assistantID: assistantId, entries: checkpoint.entries.length })
    })
    this.sessions.events.publish(event)
  }
}

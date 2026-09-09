import { createHash } from 'node:crypto'
import { z } from 'zod'
import { toJson } from '@eden/api'
import type { MonClient } from '@eden/integrations'
import type { SessionRepository } from '../sessions/index.ts'
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
function projection(sessions: SessionRepository, sessionId: string) {
  const session = sessions.read(sessionId)
  const actors = session.participants.filter((item): item is Record<string, import('@eden/api').JsonValue> => !!item && typeof item === 'object' && !Array.isArray(item))
  const scalar = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? value : null
  const assistants = actors.map(actor => scalar(actor.assistantId)).filter(value => value !== null)
  return toJson({ source: 'monagent', external_session_id: session.id, assistant: scalar(actors[0]?.assistantId), character: scalar(actors[0]?.characterId),
    title: session.title, mode: 'companion', director_policy: {}, status: session.status, last_message_at: new Date(session.updatedAt).toISOString(),
    session_payload: { id: session.id, title: session.title, status: session.status, participants: session.participants,
      environment: session.environment, participantAssistantIDs: assistants, time: { created: session.createdAt, updated: session.updatedAt } },
    session_events_payload: [],
  })
}
/** Durable idempotent Core session/participant projection, also used before first speech. */
export class MonSessionProjection {
  private readonly pending = new Map<string, Promise<string>>()
  constructor(private readonly sessions: SessionRepository) {
    sessions.database.connection.prepare("UPDATE mon_projection_outbox SET state='unknown',error='Host restarted before response confirmation' WHERE state='running'").run()
  }
  ensure(client: MonClient, sessionId: string, destination: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const db = this.sessions.database.connection
    if (db.prepare("SELECT 1 FROM legacy_core_identities WHERE session_id=? AND state='rebind_required'").get(sessionId) ||
      db.prepare("SELECT 1 FROM legacy_core_outbox WHERE session_id=? AND state IN ('held','unknown','running') LIMIT 1").get(sessionId)) {
      throw new Error('Legacy Core identity and delivery history must be reconciled before synchronization')
    }
    const body = projection(this.sessions, sessionId)
    const destinationKey = digest(destination)
    const key = digest(JSON.stringify({ destinationKey, body }))
    const existing = this.pending.get(key)
    if (existing) return existing
    const task = this.deliver(client, sessionId, key, destinationKey, body, signal)
    this.pending.set(key, task)
    void task.finally(() => this.pending.delete(key)).catch(() => {})
    return task
  }
  private async deliver(client: MonClient, sessionId: string, key: string, destination: string,
    body: import('@eden/api').JsonValue, signal: AbortSignal): Promise<string> {
    const db = this.sessions.database.connection
    db.prepare("INSERT INTO mon_projection_outbox VALUES(?,?,?,'session',?,'pending',NULL,NULL,?,?) ON CONFLICT(id) DO NOTHING")
      .run(key, sessionId, destination, JSON.stringify(body), Date.now(), Date.now())
    const row = db.prepare('SELECT state,remote_id FROM mon_projection_outbox WHERE id=?').get(key)!
    if (row.state === 'applied') return String(row.remote_id)
    // Core upserts by source/external_session_id; participant PUT replaces the full set.
    db.prepare("UPDATE mon_projection_outbox SET state='running',error=NULL,updated_at=? WHERE id=?").run(Date.now(), key)
    try {
      signal.throwIfAborted()
      const response = await client.post('/api/agent/sessions/', body, signal)
      const remote = z.object({ id: z.union([z.number().int().positive().safe(), z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)]) }).parse(response)
      const payload = body as Record<string, import('@eden/api').JsonValue>
      const metadata = payload.session_payload as Record<string, import('@eden/api').JsonValue>
      await client.put(`/api/agent/sessions/${remote.id}/participants/`, { assistant_ids: metadata.participantAssistantIDs!, mode: 'companion' }, signal)
      db.prepare("UPDATE mon_projection_outbox SET state='applied',remote_id=?,updated_at=? WHERE id=?").run(String(remote.id), Date.now(), key)
      return String(remote.id)
    } catch (error) {
      db.prepare("UPDATE mon_projection_outbox SET state='unknown',error='Session projection was not confirmed',updated_at=? WHERE id=?").run(Date.now(), key)
      throw error
    }
  }
}

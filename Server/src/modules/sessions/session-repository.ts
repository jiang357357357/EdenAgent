import { randomUUID } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import { runtimeCheckpointSchema, runtimeOriginSchema, toJson } from '@eden/api'
import type { JsonValue, RuntimeCheckpoint, RuntimeOrigin } from '@eden/api'
import type { SessionSummary } from './contracts.ts'
import { SessionEvents } from './session-events.ts'

export class SessionRepository {
  readonly events: SessionEvents
  constructor(readonly database: EdenDatabase, readonly origin: RuntimeOrigin) {
    this.events = new SessionEvents(database)
  }

  create(title: string, participants: JsonValue[] = [], environment: JsonValue = null): SessionSummary {
    const now = Date.now()
    const id = randomUUID()
    const event = this.database.transaction(() => {
      this.database.connection.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)').run(id, title, this.origin, 'active', now, now)
      return this.events.insert(id, null, 'session.created', { participants, environment })
    })
    this.events.publish(event)
    return this.read(id)
  }

  read(id: string): SessionSummary {
    const row = this.database.connection.prepare("SELECT * FROM sessions WHERE id=? AND origin=? AND status!='deleted'").get(id, this.origin)
    if (!row) throw new Error('Session not found')
    const created = this.database.connection.prepare("SELECT payload_json FROM events WHERE session_id=? AND kind IN ('session.created','session.metadata.updated') ORDER BY seq DESC LIMIT 1").get(id)
    const metadata: Record<string, unknown> = JSON.parse(String(created?.payload_json ?? '{}'))
    return {
      id: String(row.id), title: String(row.title), titleSource: 'user',
      status: row.status === 'closed' ? 'closed' : 'active', runtimeOrigin: runtimeOriginSchema.parse(row.origin),
      participants: Array.isArray(metadata.participants) ? metadata.participants.map(toJson) : [],
      environment: toJson(metadata.environment ?? null), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    }
  }

  list(limit = 100, includeClosed = false, includeBackground = true): SessionSummary[] {
    return this.database.connection.prepare(`SELECT id FROM sessions WHERE origin=? AND status!='deleted' AND (? OR status='active')
      AND (? OR NOT EXISTS (SELECT 1 FROM self_awake_submissions s JOIN jobs j ON j.id=s.job_id WHERE j.session_id=sessions.id))
      ORDER BY updated_at DESC LIMIT ?`)
      .all(this.origin, Number(includeClosed), Number(includeBackground), Math.min(limit, 1000)).map(row => this.read(String(row.id)))
  }

  rename(id: string, title: string): SessionSummary {
    this.read(id)
    const event = this.database.transaction(() => {
      this.database.connection.prepare('UPDATE sessions SET title=?, updated_at=? WHERE id=?').run(title, Date.now(), id)
      return this.events.insert(id, null, 'session.renamed', { title })
    })
    this.events.publish(event)
    return this.read(id)
  }

  setMetadata(id: string, participants?: JsonValue[], environment?: JsonValue): SessionSummary {
    const current = this.read(id)
    const event = this.database.transaction(() => {
      this.database.connection.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(Date.now(), id)
      return this.events.insert(id, null, 'session.metadata.updated', {
        participants: participants ?? current.participants, environment: environment ?? current.environment,
      })
    })
    this.events.publish(event)
    return this.read(id)
  }

  setStatus(id: string, state: 'closed' | 'deleted'): void {
    this.read(id)
    const event = this.database.transaction(() => {
      this.database.connection.prepare('UPDATE sessions SET status=?, updated_at=? WHERE id=?').run(state, Date.now(), id)
      this.database.connection.prepare("UPDATE inputs SET state='cancelled' WHERE session_id=? AND state IN ('queued','held')").run(id)
      return this.events.insert(id, null, `session.${state}`, {})
    })
    this.events.publish(event)
  }

  checkpoint(sessionId: string): RuntimeCheckpoint | undefined {
    this.assertContextReady(sessionId)
    const row = this.database.connection.prepare('SELECT checkpoint_json FROM runtime_checkpoints WHERE session_id=?').get(sessionId)
    return row ? runtimeCheckpointSchema.parse(JSON.parse(String(row.checkpoint_json))) : undefined
  }

  assertContextReady(sessionId: string): void {
    this.read(sessionId)
    const db = this.database.connection
    if (!db.prepare("SELECT 1 FROM realm_meta WHERE key='legacy_import_state'").get()) return
    const imported = db.prepare("SELECT 1 FROM legacy_conversion_ids WHERE target_id=? AND domain IN ('sessions','agent_child_sessions')").get(sessionId)
    if (!imported) return
    const context = db.prepare('SELECT state FROM legacy_runtime_contexts WHERE session_id=?').get(sessionId)
    if (context?.state !== 'prepared') throw new Error('Historical session context requires recovery before continuation')
    const child = db.prepare(`SELECT c.state FROM legacy_subagent_context c JOIN subagent_threads t ON t.id=c.agent_id
      WHERE t.child_session_id=?`).get(sessionId)
    if (child && child.state !== 'ready') throw new Error('Historical subagent policies require recovery before continuation')
  }

  saveCheckpoint(snapshot: RuntimeCheckpoint, turnId: string): void {
    const event = this.database.transaction(() => {
      this.database.connection.prepare(`INSERT INTO runtime_checkpoints VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET checkpoint_json=excluded.checkpoint_json, updated_at=excluded.updated_at`)
        .run(snapshot.sessionId, JSON.stringify(snapshot), Date.now())
      return this.events.insert(snapshot.sessionId, turnId, 'runtime.checkpoint', { entries: snapshot.entries.length })
    })
    this.events.publish(event)
  }
}

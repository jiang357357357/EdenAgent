import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { actorIdSchema, jsonValue, toJson } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'

const participantSchema = z.object({ assistantId: actorIdSchema }).catchall(jsonValue)
const rowSchema = z.object({ id: z.string(), session_id: z.string(), source_turn_id: z.string(), participant_json: z.string(),
  state: z.enum(['scheduled', 'claimed', 'failed', 'completed']), error: z.string().nullable(), created_at: z.number(), updated_at: z.number() })

export class HandoffRepository {
  constructor(private readonly sessions: SessionRepository) {}

  schedule(sessionId: string, sourceTurnId: string, target: unknown) {
    if (this.sessions.origin !== 'mon') throw new Error('Assistant handoff requires Mon')
    const session = this.sessions.read(sessionId)
    if (session.status !== 'active') throw new Error('Assistant handoff requires an active session')
    const participant = participantSchema.parse(target)
    const serialized = JSON.stringify(participant)
    if (Buffer.byteLength(serialized) > 65536) throw new Error('Assistant handoff participant exceeds 64 KiB')
    const result = this.sessions.database.transaction(() => {
      const db = this.sessions.database.connection
      const old = db.prepare('SELECT id, participant_json FROM assistant_handoffs WHERE session_id=? AND source_turn_id=?').get(sessionId, sourceTurnId)
      if (old) {
        if (old.participant_json !== serialized) throw new Error('A different assistant handoff is already scheduled for this turn')
        return { id: String(old.id) }
      }
      const turn = db.prepare("SELECT 1 FROM turns WHERE id=? AND session_id=? AND state='running'").get(sourceTurnId, sessionId)
      if (!turn) throw new Error('Assistant handoff must originate from the active turn')
      const id = randomUUID(), now = Date.now()
      db.prepare('INSERT INTO assistant_handoffs VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(id, sessionId, sourceTurnId, serialized, 'scheduled', now, now)
      return { id, event: this.sessions.events.insert(sessionId, sourceTurnId, 'session.assistant_handoff.requested',
        toJson({ jobId: id, assistantId: participant.assistantId, participant, effectiveFrom: 'next_root_run', historyPreserved: true })) }
    })
    if (result.event) this.sessions.events.publish(result.event)
    return this.read(result.id)
  }

  read(id: string) {
    const row = rowSchema.parse(this.sessions.database.connection.prepare('SELECT * FROM assistant_handoffs WHERE id=?').get(id))
    return { id: row.id, sessionId: row.session_id, sourceTurnId: row.source_turn_id,
      participant: participantSchema.parse(JSON.parse(row.participant_json)), state: row.state, error: row.error,
      createdAt: row.created_at, updatedAt: row.updated_at }
  }

  claim(sessionId: string) {
    if (this.sessions.read(sessionId).status !== 'active') return undefined
    const result = this.sessions.database.transaction(() => {
      const db = this.sessions.database.connection
      if (db.prepare("SELECT 1 FROM inputs WHERE session_id=? AND state='running'").get(sessionId) ||
        db.prepare("SELECT 1 FROM assistant_handoffs WHERE session_id=? AND state='claimed'").get(sessionId)) return undefined
      const next = db.prepare("SELECT h.id FROM assistant_handoffs h JOIN turns t ON t.id=h.source_turn_id WHERE h.session_id=? AND h.state='scheduled' AND t.state='completed' ORDER BY h.created_at, h.rowid LIMIT 1").get(sessionId)
      if (!next) return undefined
      const item = this.read(String(next.id))
      db.prepare("UPDATE assistant_handoffs SET state='claimed', updated_at=? WHERE id=?").run(Date.now(), item.id)
      return { id: item.id, event: this.sessions.events.insert(sessionId, item.sourceTurnId, 'session.assistant_handoff.claimed', { jobId: item.id }) }
    })
    if (!result) return undefined
    this.sessions.events.publish(result.event)
    return this.read(result.id)
  }

  fail(id: string, error: string): void {
    const item = this.read(id)
    const event = this.sessions.database.transaction(() => {
      const changed = this.sessions.database.connection.prepare("UPDATE assistant_handoffs SET state='failed', error=?, updated_at=? WHERE id=? AND state IN ('scheduled','claimed')")
        .run(error.slice(0, 2000), Date.now(), id)
      if (changed.changes !== 1) throw new Error('Assistant handoff is already terminal')
      return this.sessions.events.insert(item.sessionId, item.sourceTurnId, 'session.assistant_handoff.failed',
        toJson({ jobId: id, assistantId: item.participant.assistantId, participant: item.participant, error: error.slice(0, 2000) }))
    })
    this.sessions.events.publish(event)
  }

  pendingSessions(): string[] {
    return this.sessions.database.connection.prepare("SELECT DISTINCT h.session_id FROM assistant_handoffs h JOIN sessions s ON s.id=h.session_id JOIN turns t ON t.id=h.source_turn_id WHERE h.state='scheduled' AND s.status='active' AND t.state='completed'")
      .all().map(row => String(row.session_id))
  }

  release(id: string): void {
    const item = this.read(id)
    const event = this.sessions.database.transaction(() => {
      const changed = this.sessions.database.connection.prepare("UPDATE assistant_handoffs SET state='scheduled', updated_at=? WHERE id=? AND state='claimed'").run(Date.now(), id)
      if (changed.changes !== 1) throw new Error('Assistant handoff is not claimed')
      return this.sessions.events.insert(item.sessionId, item.sourceTurnId, 'session.assistant_handoff.recovered', { jobId: id })
    })
    this.sessions.events.publish(event)
  }

  recoverClaims(): void {
    const rows = this.sessions.database.connection.prepare("SELECT id FROM assistant_handoffs WHERE state='claimed'").all()
    for (const row of rows) this.release(String(row.id))
  }
}

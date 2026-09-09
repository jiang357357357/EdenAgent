import { randomUUID } from 'node:crypto'
import { jsonValue } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { SessionInput, AcceptedInput } from '../contracts.ts'
import { SessionEvents } from '../session-events.ts'

export class InputRepository {
  constructor(private readonly database: EdenDatabase, private readonly events: SessionEvents) {}

  pendingSessions(): string[] {
    return this.database.connection.prepare("SELECT DISTINCT session_id FROM inputs WHERE state='queued'").all().map(row => String(row.session_id))
  }

  interruptedSessions(): string[] {
    return this.database.connection.prepare("SELECT DISTINCT session_id FROM inputs WHERE state='running'").all().map(row => String(row.session_id))
  }

  hasPending(sessionId: string): boolean {
    return Boolean(this.database.connection.prepare("SELECT 1 FROM inputs WHERE session_id=? AND state='queued' LIMIT 1").get(sessionId))
  }

  enqueue(sessionId: string, text: string, idempotencyKey: string, metadata: JsonValue = {}, kind: 'prompt' | 'compact' = 'prompt', environmentUpdate?: JsonValue, onCommit?: (input: AcceptedInput) => void): AcceptedInput {
    const result = this.database.transaction(() => {
      const old = this.database.connection.prepare('SELECT * FROM inputs WHERE session_id=? AND idempotency_key=?').get(sessionId, idempotencyKey)
      if (old) {
        if (old.text !== text || old.metadata_json !== JSON.stringify(metadata) || old.kind !== kind) throw new Error('Idempotency key already used for a different input')
        const accepted = { sessionId, turnId: String(old.turn_id), inputId: String(old.id), state: String(old.state) }
        onCommit?.(accepted)
        return { accepted }
      }
      const id = randomUUID()
      const turnId = randomUUID()
      this.database.connection.prepare('INSERT INTO inputs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, sessionId, turnId, idempotencyKey, text, 'queued', Date.now(), JSON.stringify(metadata), kind)
      onCommit?.({ sessionId, turnId, inputId: id, state: 'queued' })
      const environmentEvent = environmentUpdate === undefined ? undefined : this.events.insert(sessionId, turnId, 'session.metadata.updated', environmentUpdate)
      const changedEvent = environmentUpdate === undefined ? undefined : this.events.insert(sessionId, turnId, 'session.environment_updated', environmentUpdate)
      return {
        environmentEvent, changedEvent,
        accepted: { sessionId, turnId, inputId: id, state: 'queued' },
        event: this.events.insert(sessionId, turnId, 'input.queued', { text, inputId: id, kind, metadata }),
      }
    })
    if (result.environmentEvent) this.events.publish(result.environmentEvent)
    if (result.changedEvent) this.events.publish(result.changedEvent)
    if (result.event) this.events.publish(result.event)
    return result.accepted
  }

  claim(sessionId: string): SessionInput | undefined {
    const result = this.database.transaction(() => {
      const row = this.database.connection.prepare("SELECT * FROM inputs WHERE session_id=? AND state='queued' ORDER BY created_at, rowid LIMIT 1").get(sessionId)
      if (!row) return undefined
      const input: SessionInput = { id: String(row.id), sessionId, turnId: String(row.turn_id), text: String(row.text), state: 'running',
        metadata: jsonValue.parse(JSON.parse(String(row.metadata_json))), kind: row.kind === 'compact' ? 'compact' : 'prompt' }
      const now = Date.now()
      this.database.connection.prepare("UPDATE inputs SET state='running' WHERE id=?").run(input.id)
      this.database.connection.prepare('INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?)').run(input.turnId, sessionId, 'running', null, now, now)
      return { input, event: this.events.insert(sessionId, input.turnId, 'turn.started', { inputId: input.id }) }
    })
    if (result) this.events.publish(result.event)
    return result?.input
  }

  finish(input: SessionInput, error?: string): void {
    const state = error ? 'interrupted' : 'completed'
    const event = this.database.transaction(() => {
      this.database.connection.prepare('UPDATE inputs SET state=? WHERE id=?').run(state, input.id)
      this.database.connection.prepare('UPDATE turns SET state=?, error=?, updated_at=? WHERE id=?').run(state, error ?? null, Date.now(), input.turnId)
      this.database.connection.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(Date.now(), input.sessionId)
      return this.events.insert(input.sessionId, input.turnId, error ? 'input.interrupted' : 'turn.completed', { inputId: input.id, reason: error ?? null })
    })
    this.events.publish(event)
  }

  recoverInterrupted(): number {
    const rows = this.database.connection.prepare("SELECT * FROM inputs WHERE state='running'").all()
    for (const row of rows) {
      // Future queued inputs need explicit resubmission after an uncertain turn; repeated restarts cannot release them.
      this.database.connection.prepare("UPDATE inputs SET state='held' WHERE session_id=? AND state='queued'").run(row.session_id!)
      this.finish({ id: String(row.id), sessionId: String(row.session_id), turnId: String(row.turn_id), text: String(row.text), state: 'running' }, 'Server restarted during execution')
    }
    this.database.connection.prepare("UPDATE tool_operations SET state='unknown', updated_at=? WHERE state='running'").run(Date.now())
    return rows.length
  }
}

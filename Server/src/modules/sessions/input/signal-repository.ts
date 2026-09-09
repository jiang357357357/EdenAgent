import { randomUUID } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import type { JsonValue } from '@eden/api'
import { SessionEvents } from '../session-events.ts'

export class SignalRepository {
  constructor(private readonly database: EdenDatabase, private readonly events: SessionEvents) {}

  create(sessionId: string, turnId: string, kind: 'steer' | 'follow_up', text: string): string {
    const id = randomUUID()
    const event = this.database.transaction(() => {
      const row = this.database.connection.prepare("SELECT COUNT(*) AS count FROM input_signals WHERE session_id=? AND state IN ('accepted','injected')").get(sessionId)
      if (Number(row?.count) >= 64) throw new Error('Session signal queue is full')
      this.database.connection.prepare('INSERT INTO input_signals VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, sessionId, turnId, kind, text, 'accepted', Date.now())
      return this.events.insert(sessionId, turnId, 'input.signal.accepted', { inputId: id, kind, text })
    })
    this.events.publish(event)
    return id
  }

  setState(id: string, state: 'injected' | 'rejected'): void {
    const row = this.database.connection.prepare('SELECT * FROM input_signals WHERE id=?').get(id)
    if (!row || row.state !== 'accepted') return
    const event = this.database.transaction(() => {
      this.database.connection.prepare('UPDATE input_signals SET state=? WHERE id=?').run(state, id)
      return this.events.insert(String(row.session_id), String(row.turn_id), `input.signal.${state}`, { inputId: id })
    })
    this.events.publish(event)
  }

  consume(sessionId: string, turnId: string, payload: JsonValue): boolean {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
    const message = payload.message
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.role !== 'user') return false
    const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.map(item =>
      item && typeof item === 'object' && !Array.isArray(item) && item.type === 'text' ? item.text : '').join('') : ''
    const row = this.database.connection.prepare("SELECT id FROM input_signals WHERE session_id=? AND turn_id=? AND text=? AND state IN ('accepted','injected') ORDER BY created_at, rowid LIMIT 1").get(sessionId, turnId, text)
    if (!row) return false
    const event = this.database.transaction(() => {
      this.database.connection.prepare("UPDATE input_signals SET state='consumed' WHERE id=?").run(row.id!)
      return this.events.insert(sessionId, turnId, 'input.signal.consumed', { inputId: String(row.id) })
    })
    this.events.publish(event)
    return true
  }

  interrupt(turnId?: string): void {
    const rows = turnId ? this.database.connection.prepare("SELECT * FROM input_signals WHERE turn_id=? AND state IN ('accepted','injected')").all(turnId) :
      this.database.connection.prepare("SELECT * FROM input_signals WHERE state IN ('accepted','injected')").all()
    for (const row of rows) {
      const event = this.database.transaction(() => {
        this.database.connection.prepare("UPDATE input_signals SET state='interrupted' WHERE id=?").run(row.id!)
        return this.events.insert(String(row.session_id), String(row.turn_id), 'input.signal.interrupted', { inputId: String(row.id) })
      })
      this.events.publish(event)
    }
  }
}

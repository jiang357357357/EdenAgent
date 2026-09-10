import { randomUUID } from 'node:crypto'
import { desktopReminderCreateSchema, desktopReminderSchema, desktopReminderIdSchema, desktopReminderListSchema, toJson } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'

export class DesktopReminderRepository {
  constructor(private readonly sessions: SessionRepository) {}

  create(sessionId: string, turnId: string, raw: unknown, operationKey: string) {
    const input = desktopReminderCreateSchema.parse(raw)
    const session = this.sessions.read(sessionId)
    if (session.status !== 'active') throw new Error('Reminder requires an active session')
    const result = this.sessions.database.transaction(() => {
      const existing = this.sessions.database.connection.prepare('SELECT id FROM desktop_reminders WHERE operation_key=?').get(operationKey)
      if (existing) return { reminder: this.read(String(existing.id)) }
      const id = randomUUID(), now = Date.now()
      const participant = session.participants[0]
      const author = participant && typeof participant === 'object' && !Array.isArray(participant)
        ? { assistantId: participant.assistantId ?? null, characterId: participant.characterId ?? null,
          assistantName: participant.assistantName ?? '', characterName: participant.characterName ?? '' } : {}
      this.sessions.database.connection.prepare(`INSERT INTO desktop_reminders(id,session_id,turn_id,title,message,state,author_json,operation_key,created_at)
        VALUES(?,?,?,?,?,'pending',?,?,?)`).run(id, sessionId, turnId, input.title, input.message, JSON.stringify(author), operationKey, now)
      const reminder = this.read(id)
      return { reminder, event: this.sessions.events.insert(sessionId, turnId, 'desktop.reminder.created', toJson(reminder)) }
    })
    if (result.event) this.sessions.events.publish(result.event)
    return result.reminder
  }

  read(id: string) {
    desktopReminderIdSchema.parse({ id })
    const row = this.sessions.database.connection.prepare('SELECT * FROM desktop_reminders WHERE id=?').get(id)
    if (!row) throw new Error('Desktop reminder not found')
    return desktopReminderSchema.parse({ id: row.id, sessionId: row.session_id, turnId: row.turn_id, title: row.title, message: row.message,
      state: row.state, author: JSON.parse(String(row.author_json)), createdAt: row.created_at, displayedAt: row.displayed_at, closedAt: row.closed_at })
  }

  list(raw: unknown) {
    const input = desktopReminderListSchema.parse(raw)
    return this.sessions.database.connection.prepare("SELECT id FROM desktop_reminders WHERE (? OR state='pending') ORDER BY created_at,id LIMIT ?")
      .all(Number(input.includeClosed), input.limit).map(row => this.read(String(row.id)))
  }

  transition(id: string, state: 'displayed' | 'closed') {
    const result = this.sessions.database.transaction(() => {
      const current = this.read(id)
      if (current.state === 'closed' || current.state === state) return { reminder: current }
      if (current.turnId === null || ['unknown', 'failed'].includes(current.state)) throw new Error('Historical reminder cannot be transitioned through live display acknowledgements')
      const now = Date.now()
      this.sessions.database.connection.prepare("UPDATE desktop_reminders SET state=?,displayed_at=CASE WHEN ?='displayed' THEN COALESCE(displayed_at,?) ELSE displayed_at END,closed_at=? WHERE id=?")
        .run(state, state, now, state === 'closed' ? now : null, id)
      const reminder = this.read(id)
      return { reminder, event: this.sessions.events.insert(current.sessionId, current.turnId, `desktop.reminder.${state}`, toJson(reminder)) }
    })
    if (result.event) this.sessions.events.publish(result.event)
    return result.reminder
  }
}

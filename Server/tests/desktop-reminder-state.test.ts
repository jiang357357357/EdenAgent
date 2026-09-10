import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { DesktopReminderRepository } from '../src/modules/notifications/index.ts'

test('desktop display acknowledgements and closing persist once with their events', () => {
  const db = new EdenDatabase(':memory:', 'local')
  try {
    const sessions = new SessionRepository(db, 'local'), session = sessions.create('Reminder')
    const reminders = new DesktopReminderRepository(sessions)
    const inputs = new InputRepository(db, sessions.events)
    inputs.enqueue(session.id, 'Reminder', 'reminder-input')
    const input = inputs.claim(session.id)!
    const created = reminders.create(session.id, input.turnId, { title: 'Break', message: 'Drink water' }, 'reminder-1')
    const displayed = reminders.transition(created.id, 'displayed')
    assert.equal(displayed.state, 'displayed'); assert.ok(displayed.displayedAt)
    assert.deepEqual(reminders.transition(created.id, 'displayed'), displayed)
    const closed = reminders.transition(created.id, 'closed')
    assert.equal(closed.displayedAt, displayed.displayedAt); assert.ok(closed.closedAt)
    assert.equal(reminders.transition(created.id, 'displayed').state, 'closed')
    assert.equal(sessions.events.list(session.id).filter(event => event.kind === 'desktop.reminder.displayed').length, 1)
  } finally { db.close() }
})

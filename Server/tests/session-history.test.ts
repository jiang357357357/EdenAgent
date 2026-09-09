import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { sessionRoutes } from '../src/transport/rpc/session.routes.ts'

test('message pagination, participant metadata, rename, close and deletion use persisted session state', async () => {
  const database = new EdenDatabase(':memory:', 'local')
  const repository = new SessionRepository(database, 'local')
  const model = await recordedModel([{ text: 'First answer' }, { text: 'Second answer' }])
  const sessions = new SessionService(repository, model.config)
  const routes = sessionRoutes(sessions)
  try {
    const session = repository.create('Before', [], null)
    await routes['session.rename']!({ sessionId: session.id, title: 'After' })
    await routes['session.set_participants']!({ sessionId: session.id, participants: [{ characterName: 'Test character' }] })
    assert.equal(repository.read(session.id).title, 'After')
    sessions.start(session.id, 'First question', 'first', { timezone: 'Asia/Shanghai' })
    await sessions.waitForIdle(session.id)
    sessions.start(session.id, 'Second question', 'second')
    await sessions.waitForIdle(session.id)
    assert.match(JSON.stringify(model.requests[0]), /Test character/)
    assert.match(JSON.stringify(model.requests[0]), /Asia\/Shanghai/)
    const recent = repository.events.messages(session.id, undefined, 2)
    assert.equal(recent.hasMore, true)
    assert.match(JSON.stringify(recent.items), /Second answer/)
    const older = repository.events.messages(session.id, recent.nextCursor!, 2)
    assert.equal(older.hasMore, false)
    assert.match(JSON.stringify(older.items), /First answer/)
    const another = repository.create('Other')
    assert.throws(() => repository.events.messages(another.id, recent.nextCursor!, 2), /cursor/)
    await routes['session.close']!({ sessionId: session.id })
    assert.equal(repository.read(session.id).status, 'closed')
    assert.throws(() => sessions.start(session.id, 'Closed'), /closed/)
    await routes['session.delete']!({ sessionId: session.id })
    assert.throws(() => repository.read(session.id), /not found/)
    assert.deepEqual(repository.list(100, true).map(item => item.id), [another.id])
  } finally { await sessions.close(); await model.close(); database.close() }
})

test('manual compaction captures its actual model request and checkpoint', async () => {
  const database = new EdenDatabase(':memory:', 'local')
  const repository = new SessionRepository(database, 'local')
  const model = await recordedModel([{ text: 'Detailed prior answer '.repeat(500) }, { text: 'A summary for the next turn' }])
  const sessions = new SessionService(repository, model.config)
  try {
    const session = repository.create('Compaction')
    sessions.start(session.id, 'Detailed context '.repeat(500))
    await sessions.waitForIdle(session.id)
    sessions.start(session.id, 'Keep essential facts', undefined, undefined, 'compact')
    await sessions.waitForIdle(session.id)
    assert.equal(model.requests.length, 2)
    assert.match(JSON.stringify(repository.checkpoint(session.id)), /A summary for the next turn/)
    assert.ok(repository.events.list(session.id, '0', 1000).filter(event => event.kind === 'model.request').length === 2)
  } finally { await sessions.close(); await model.close(); database.close() }
})

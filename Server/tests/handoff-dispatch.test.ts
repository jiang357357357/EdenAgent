import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { ModelService } from '../src/modules/models/index.ts'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { HandoffDispatcher } from '../src/modules/handoffs/index.ts'

async function fixture(initiallyReady = true) {
  const first = await recordedModel([{ tool: 'schedule_switch', input: {} }, { text: 'Old assistant farewell' }])
  const next = await recordedModel([{ text: 'New assistant reply' }])
  const db = new EdenDatabase(':memory:', 'mon')
  const repository = new SessionRepository(db, 'mon')
  const session = repository.create('Dispatch handoff', [{ assistantId: 1 }])
  const models = new ModelService('mon')
  models.bind(session.id, { model: first.config, entityId: 1, label: 'Old' })
  let ready = initiallyReady, attempts = 0
  const dispatcher = new HandoffDispatcher(repository, models, async (_sessionId, assistantId) => {
    attempts++
    assert.equal(assistantId, 2)
    return ready ? { binding: { model: next.config, entityId: 2, label: 'Next' } } : undefined
  })
  const sessions = new SessionService(repository, id => models.resolve(id), (sessionId, turnId) => [{
    name: 'schedule_switch', revision: 'test', description: 'Test scheduling boundary', parameters: { type: 'object' },
    async execute() { dispatcher.repository.schedule(sessionId, turnId, { assistantId: 2, assistantName: 'Next' }); return { scheduled: true } },
  }], undefined, undefined, dispatcher)
  return { first, next, db, repository, session, models, dispatcher, sessions, attempts: () => attempts, enable: () => { ready = true },
    async close() { await sessions.close(); db.close(); await Promise.all([first.close(), next.close()]) } }
}

for (const queued of [true, false]) {
  test(`session queue dispatches handoff before ${queued ? 'an existing queued input' : 'an internal greeting'}`, async () => {
    const f = await fixture()
    try {
      let boundAtCompletion = false
      f.repository.events.subscribe(event => { if (event.kind === 'session.assistant_handoff.completed') boundAtCompletion = f.models.resolve(f.session.id)?.baseUrl === f.next.config.baseUrl })
      f.sessions.start(f.session.id, 'Switch please', 'source')
      if (queued) f.sessions.start(f.session.id, 'Queued actual user question', 'next')
      await f.sessions.waitForIdle(f.session.id)
      assert.equal(f.sessions.faultCount(), 0)
      assert.equal(f.first.requests.length, 2)
      assert.equal(f.next.requests.length, 1)
      assert.equal(boundAtCompletion, true)
      assert.equal(f.db.connection.prepare('SELECT state FROM assistant_handoffs').get()?.state, 'completed')
      assert.equal(f.db.connection.prepare("SELECT COUNT(*) AS count FROM inputs WHERE state='completed'").get()?.count, 2)
      assert.match(JSON.stringify(f.next.requests[0]), /Old assistant farewell/)
      if (queued) assert.match(JSON.stringify(f.next.requests[0]), /Queued actual user question/)
      const publicMessages = JSON.stringify(f.repository.events.messages(f.session.id, undefined, 100))
      assert.match(publicMessages, /New assistant reply/)
      assert.doesNotMatch(publicMessages, /你刚接手此会话/)
    } finally { await f.close() }
  })
}

test('missing handoff credentials pause the queue until explicit binding refresh resumes it', async () => {
  const f = await fixture(false)
  try {
    f.sessions.start(f.session.id, 'Switch please')
    f.sessions.start(f.session.id, 'Wait for new actor')
    await f.sessions.waitForIdle(f.session.id)
    assert.equal(f.attempts(), 1)
    assert.equal(f.next.requests.length, 0)
    assert.equal(f.db.connection.prepare('SELECT state FROM assistant_handoffs').get()?.state, 'scheduled')
    assert.equal(f.db.connection.prepare("SELECT COUNT(*) AS count FROM inputs WHERE state='queued'").get()?.count, 1)
    f.enable(); f.sessions.resumePending()
    await f.sessions.waitForIdle(f.session.id)
    assert.equal(f.attempts(), 2)
    assert.equal(f.next.requests.length, 1)
    assert.equal(f.sessions.faultCount(), 0)
  } finally { await f.close() }
})

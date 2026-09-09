import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { CompanionTurnCoordinator, DirectorRunRepository } from '../src/modules/director/index.ts'
import { publicMessage } from '../src/modules/sessions/history/public-message.ts'

async function fixture(wait = false) {
  const director = await recordedModel([{ text: '{"beats":[{"assistantId":1},{"assistantId":2}]}' }])
  const first = await recordedModel([wait ? { wait: true } : { text: 'First actor public reply' }])
  const second = await recordedModel([{ text: 'Second actor public reply' }])
  const db = new EdenDatabase(':memory:', 'mon')
  const sessions = new SessionRepository(db, 'mon')
  const runs = new DirectorRunRepository(sessions)
  const coordinator = new CompanionTurnCoordinator(sessions, runs)
  const session = sessions.create('Coordinated actors')
  const controller = new AbortController()
  return { director, first, second, db, sessions, runs, coordinator, controller,
    request: { input: { id: randomUUID(), sessionId: session.id, turnId: randomUUID(), text: 'Work together', state: 'running' },
      participants: [{ assistantId: 1 }, { assistantId: 2 }], directorModel: director.config,
      actorModels: new Map([['1', first.config], ['2', second.config]]), tools: () => [], signal: controller.signal },
    async close() { controller.abort(); await coordinator.close(); db.close(); await Promise.all([director.close(), first.close(), second.close()]) } }
}

test('shared conversation excludes private reasoning, tool arguments and unrecognized actor fields', () => {
  const result = publicMessage({ actor: { assistantID: 1, secret: 'private-actor' }, message: { role: 'assistant',
    content: [{ type: 'thinking', thinking: 'private-reasoning' }, { type: 'toolCall', arguments: { secret: 'private-tool' } }, { type: 'text', text: 'Public reply' }] } })
  assert.deepEqual(result, { role: 'assistant', text: 'Public reply', assistantID: 1 })
  assert.equal(publicMessage({ message: { role: 'toolResult', content: [{ type: 'text', text: 'private-result' }] } }), null)
})

test('one director plan executes both actor models and shares only public replies in beat order', async () => {
  const setup = await fixture()
  try {
    const result = await setup.coordinator.execute(setup.request)
    assert.equal(result.status, 'completed')
    assert.deepEqual(result.completedBeatIndexes, [0, 1])
    assert.equal(setup.director.requests.length, 1)
    assert.equal(setup.first.requests.length, 1)
    assert.equal(setup.second.requests.length, 1)
    assert.match(JSON.stringify(setup.second.requests[0]?.messages), /First actor public reply/)
    const messages = setup.sessions.events.messages(setup.request.input.sessionId, undefined, 100).items
    assert.equal(messages.length, 3)
    assert.match(JSON.stringify(messages[0]?.payload), /"role":"user"/)
    assert.match(JSON.stringify(messages[1]?.payload), /"assistantID":1/)
    assert.match(JSON.stringify(messages[2]?.payload), /"assistantID":2/)
  } finally { await setup.close() }
})

test('cancellation during a beat stops later actors and persists a failed director run', async () => {
  const setup = await fixture(true)
  const task = setup.coordinator.execute(setup.request)
  const rejected = assert.rejects(task)
  try {
    const deadline = Date.now() + 5000
    while (!setup.first.requests.length && Date.now() < deadline) await delay(10)
    assert.equal(setup.first.requests.length, 1)
    setup.controller.abort()
    await rejected
    assert.equal(setup.second.requests.length, 0)
    const run = setup.runs.list(setup.request.input.sessionId)[0]!
    assert.equal(run.status, 'failed')
    assert.deepEqual(run.completedBeatIndexes, [])
    assert.match(run.error!, /cancelled/)
  } finally { setup.controller.abort(); await rejected; await setup.close() }
})

test('a beat completion commit failure prevents the next actor request', async () => {
  const setup = await fixture()
  try {
    setup.db.connection.exec("CREATE TRIGGER reject_beat BEFORE INSERT ON events WHEN NEW.kind='director.beat.completed' BEGIN SELECT RAISE(ABORT, 'commit failure'); END")
    await assert.rejects(setup.coordinator.execute(setup.request), /commit failure/)
    assert.equal(setup.first.requests.length, 1)
    assert.equal(setup.second.requests.length, 0)
    const run = setup.runs.list(setup.request.input.sessionId)[0]!
    assert.equal(run.status, 'failed')
    assert.deepEqual(run.completedBeatIndexes, [])
  } finally { await setup.close() }
})

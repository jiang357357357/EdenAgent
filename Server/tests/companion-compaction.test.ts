import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { ModelService } from '../src/modules/models/index.ts'
import { ActorCheckpointRepository } from '../src/modules/actors/index.ts'
import { CompanionTurnCoordinator, CompanionSessionExtension, DirectorRunRepository } from '../src/modules/director/index.ts'

async function fixture(waitSecond = false) {
  const first = await recordedModel([{ text: '{"beats":[{"assistantId":1},{"assistantId":2}]}' },
    { text: 'First detailed answer '.repeat(500) }, { text: 'First compact summary' }])
  const second = await recordedModel([{ text: 'Second detailed answer '.repeat(500) }, waitSecond ? { wait: true } : { text: 'Second compact summary' }])
  const db = new EdenDatabase(':memory:', 'mon')
  const repository = new SessionRepository(db, 'mon')
  const models = new ModelService('mon')
  const runs = new DirectorRunRepository(repository)
  const coordinator = new CompanionTurnCoordinator(repository, runs)
  const extension = new CompanionSessionExtension(coordinator, models, () => [])
  const sessions = new SessionService(repository, id => models.resolve(id), () => [], undefined, extension)
  const session = repository.create('Actor compaction', [{ assistantId: 1 }, { assistantId: 2 }])
  models.bindActors(session.id, [first, second].map((model, index) => ({ assistantId: index + 1, characterId: index + 1,
    main: { model: model.config, entityId: index + 1, label: `Actor ${index + 1}` } })), first.config)
  return { first, second, db, repository, runs, coordinator, sessions, session, checkpoints: new ActorCheckpointRepository(repository),
    async prepare() { sessions.start(session.id, 'Detailed context '.repeat(500)); await sessions.waitForIdle(session.id); assert.equal(sessions.faultCount(), 0) },
    async close() { await sessions.close(); await coordinator.close(); db.close(); await Promise.all([first.close(), second.close()]) } }
}

test('queued multi-actor compaction updates each private checkpoint without creating a new director plan', async () => {
  const setup = await fixture()
  try {
    await setup.prepare()
    setup.sessions.start(setup.session.id, 'Keep essential facts', undefined, undefined, 'compact')
    await setup.sessions.waitForIdle(setup.session.id)
    assert.equal(setup.sessions.faultCount(), 0)
    assert.equal(setup.first.requests.length, 3)
    assert.equal(setup.second.requests.length, 2)
    assert.match(JSON.stringify(setup.checkpoints.read(setup.session.id, 1)), /First compact summary/)
    assert.match(JSON.stringify(setup.checkpoints.read(setup.session.id, 2)), /Second compact summary/)
    assert.equal(setup.runs.list(setup.session.id).length, 1)
    assert.equal(setup.repository.checkpoint(setup.session.id), undefined)
    assert.equal(setup.db.connection.prepare("SELECT state FROM inputs WHERE kind='compact'").get()?.state, 'completed')
  } finally { await setup.close() }
})

test('cancelling the second actor compaction preserves the first summary and the second original checkpoint', async () => {
  const setup = await fixture(true)
  try {
    await setup.prepare()
    const before = setup.checkpoints.read(setup.session.id, 2)
    setup.sessions.start(setup.session.id, 'Summarize', undefined, undefined, 'compact')
    const deadline = Date.now() + 5000
    while (setup.second.requests.length < 2 && Date.now() < deadline) await delay(10)
    assert.equal(setup.second.requests.length, 2)
    await setup.sessions.cancel(setup.session.id)
    await setup.sessions.waitForIdle(setup.session.id)
    assert.equal(setup.sessions.faultCount(), 0)
    assert.match(JSON.stringify(setup.checkpoints.read(setup.session.id, 1)), /First compact summary/)
    assert.deepEqual(setup.checkpoints.read(setup.session.id, 2), before)
    assert.equal(setup.db.connection.prepare("SELECT state FROM inputs WHERE kind='compact'").get()?.state, 'interrupted')
    const events = setup.repository.events.list(setup.session.id, '0', 1000)
    assert.equal(events.filter(event => event.kind === 'actor.compaction.completed').length, 1)
    assert.equal(events.filter(event => event.kind === 'actor.compaction.cancelled').length, 1)
  } finally { await setup.close() }
})

test('compaction skips actors without history and does not contact any model', async () => {
  const setup = await fixture()
  try {
    setup.sessions.start(setup.session.id, 'Summarize', undefined, undefined, 'compact')
    await setup.sessions.waitForIdle(setup.session.id)
    assert.equal(setup.sessions.faultCount(), 0)
    assert.equal(setup.first.requests.length + setup.second.requests.length, 0)
    assert.equal(setup.repository.events.list(setup.session.id).filter(event => event.kind === 'actor.compaction.skipped').length, 2)
  } finally { await setup.close() }
})

test('actor compaction request persistence failure prevents both summary requests and preserves checkpoints', async () => {
  const setup = await fixture()
  try {
    await setup.prepare()
    const before = [1, 2].map(id => setup.checkpoints.read(setup.session.id, id))
    setup.db.connection.exec("CREATE TRIGGER reject_compaction_request BEFORE INSERT ON events WHEN NEW.kind='model.request' BEGIN SELECT RAISE(ABORT, 'request disk failure'); END")
    setup.sessions.start(setup.session.id, 'Summarize', undefined, undefined, 'compact')
    await setup.sessions.waitForIdle(setup.session.id)
    assert.equal(setup.sessions.faultCount(), 1)
    assert.equal(setup.first.requests.length, 2)
    assert.equal(setup.second.requests.length, 1)
    assert.deepEqual([1, 2].map(id => setup.checkpoints.read(setup.session.id, id)), before)
    assert.equal(setup.db.connection.prepare("SELECT state FROM inputs WHERE kind='compact'").get()?.state, 'interrupted')
  } finally { await setup.close() }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { ModelService, ModelBindingRepository } from '../src/modules/models/index.ts'
import { HandoffDispatcher } from '../src/modules/handoffs/index.ts'

const model = { id: 'old', provider: 'test', baseUrl: 'https://model.invalid/v1', apiKey: 'private-key', contextWindow: 32000, maxTokens: 1024 }

function fixture(context: test.TestContext) {
  const db = new EdenDatabase(':memory:', 'mon')
  context.after(() => db.close())
  const sessions = new SessionRepository(db, 'mon')
  const session = sessions.create('Durable handoff', [{ assistantId: 1 }])
  const bindings = new ModelBindingRepository(db)
  const models = new ModelService('mon', undefined, bindings)
  models.bind(session.id, { model, entityId: 1, label: 'Old' })
  const dispatcher = new HandoffDispatcher(sessions, models, async () => ({
    binding: { model: { ...model, id: 'new' }, entityId: 2, label: 'New' },
    visionBinding: { model: { ...model, id: 'vision' }, entityId: 3, label: 'Vision' },
  }), bindings)
  const inputs = new InputRepository(db, sessions.events)
  inputs.enqueue(session.id, 'Switch role', 'source')
  const source = inputs.claim(session.id)!
  const job = dispatcher.repository.schedule(session.id, source.turnId, { assistantId: 2 })
  inputs.finish(source)
  return { db, sessions, session, bindings, models, dispatcher, inputs, job }
}

test('handoff atomically saves target models and role, then publishes after the runtime binding is ready', async context => {
  const f = fixture(context)
  let observed = ''
  f.sessions.events.subscribe(event => {
    if (event.kind === 'session.assistant_handoff.completed') observed = f.models.resolve(f.session.id)!.id
  })
  await f.dispatcher.run(f.session.id, new AbortController().signal)
  assert.equal(observed, 'new')
  assert.deepEqual(f.sessions.read(f.session.id).participants, [{ assistantId: 2 }])
  const restored = new ModelService('mon', undefined, new ModelBindingRepository(f.db))
  assert.equal(restored.resolve(f.session.id)?.id, 'new')
  assert.equal(restored.resolveVision(f.session.id)?.id, 'vision')
  assert.equal(f.dispatcher.repository.read(f.job.id).state, 'completed')
  assert.equal((f.inputs.claim(f.session.id)!.metadata as { model: { id: string } }).model.id, 'new')
  assert.ok(!JSON.stringify(f.sessions.events.list(f.session.id)).includes('private-key'))
})

test('late handoff failure rolls back saved model, target role, queued greeting and completion state', async context => {
  const f = fixture(context)
  f.db.connection.exec("CREATE TRIGGER fail_handoff_event BEFORE INSERT ON events WHEN NEW.kind='session.assistant_handoff.completed' BEGIN SELECT RAISE(ABORT, 'handoff event failure'); END")
  await assert.rejects(f.dispatcher.run(f.session.id, new AbortController().signal), /event failure/)
  assert.deepEqual(f.sessions.read(f.session.id).participants, [{ assistantId: 1 }])
  assert.equal(f.models.resolve(f.session.id)?.id, 'old')
  assert.equal(new ModelService('mon', undefined, f.bindings).resolve(f.session.id)?.id, 'old')
  assert.equal(f.inputs.claim(f.session.id), undefined)
  assert.equal(f.dispatcher.repository.read(f.job.id).state, 'claimed')
  f.db.connection.exec('DROP TRIGGER fail_handoff_event')
  f.dispatcher.repository.recoverClaims()
  await f.dispatcher.run(f.session.id, new AbortController().signal)
  assert.equal(f.models.resolve(f.session.id)?.id, 'new')
})

test('binding storage failure prevents role handoff and mismatched persistence wiring is rejected', async context => {
  const f = fixture(context)
  f.db.connection.exec("CREATE TRIGGER fail_handoff_binding BEFORE UPDATE ON model_bindings BEGIN SELECT RAISE(ABORT, 'binding storage failure'); END")
  await assert.rejects(f.dispatcher.run(f.session.id, new AbortController().signal), /storage failure/)
  assert.deepEqual(f.sessions.read(f.session.id).participants, [{ assistantId: 1 }])
  assert.equal(f.models.resolve(f.session.id)?.id, 'old')
  assert.equal(f.inputs.claim(f.session.id), undefined)
  assert.throws(() => new HandoffDispatcher(f.sessions, f.models, async () => undefined), /durable binding configuration/)
})

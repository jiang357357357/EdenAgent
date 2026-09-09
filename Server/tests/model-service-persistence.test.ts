import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { ModelService, ModelBindingRepository } from '../src/modules/models/index.ts'

const model = { id: 'main', provider: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'private-key', contextWindow: 10000, maxTokens: 1000 }
const binding = { model, entityId: 1, label: 'Main' }

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-model-service-'))
  const filename = path.join(root, 'test.sqlite')
  let db = new EdenDatabase(filename, 'mon')
  let sessions = new SessionRepository(db, 'mon')
  let models = new ModelService('mon', undefined, new ModelBindingRepository(db))
  context.after(async () => { db.close(); await rm(root, { recursive: true, force: true }) })
  return { get db() { return db }, get sessions() { return sessions }, get models() { return models },
    reopen() { db.close(); db = new EdenDatabase(filename, 'mon'); sessions = new SessionRepository(db, 'mon'); models = new ModelService('mon', undefined, new ModelBindingRepository(db)) } }
}

test('ModelService restores main and vision after reopen and never exposes their credentials in status', async context => {
  const f = await fixture(context)
  const session = f.sessions.create('Single', [{ assistantId: 1 }])
  f.models.bind(session.id, binding)
  f.models.bindVision(session.id, { ...model, id: 'vision' })
  f.reopen()
  assert.equal(f.models.resolve(session.id)?.id, 'main')
  assert.equal(f.models.resolveVision(session.id)?.id, 'vision')
  assert.ok(!JSON.stringify(f.models.read(session.id)).includes('private-key'))
  f.models.resolve(session.id)!.id = 'caller mutation'
  assert.equal(f.models.resolve(session.id)?.id, 'main')
  f.models.invalidateSession(session.id)
  f.reopen()
  assert.equal(f.models.resolve(session.id), undefined)
  assert.equal(f.models.resolveVision(session.id), undefined)
})

test('multi-actor snapshots restore each model and director and replace as a complete binding set', async context => {
  const f = await fixture(context)
  const session = f.sessions.create('Multiple', [{ assistantId: 1 }, { assistantId: 2 }])
  f.models.bindActors(session.id, [1, 2].map(assistantId => ({ assistantId, characterId: assistantId * 11,
    main: { ...binding, model: { ...model, id: `actor-${assistantId}` } },
    vision: { ...binding, model: { ...model, id: `vision-${assistantId}` } },
  })), { ...model, id: 'director' })
  f.reopen()
  assert.equal(f.models.resolveActorModel(session.id, 1)?.id, 'actor-1')
  assert.equal(f.models.resolveActor(session.id, 2)?.vision?.model.id, 'vision-2')
  assert.equal(f.models.resolveDirector(session.id)?.id, 'director')
  assert.equal(f.models.read(session.id, f.sessions.read(session.id).participants).available, true)
  f.sessions.setMetadata(session.id, [{ assistantId: 3 }])
  assert.equal(f.models.resolveActorModel(session.id, 1), undefined)
  f.models.bind(session.id, binding)
  f.reopen()
  assert.equal(f.models.resolve(session.id)?.id, 'main')
  assert.equal(f.models.resolveDirector(session.id), undefined)
  assert.equal(f.models.resolveActorModel(session.id, 2), undefined)
})

test('failed durable replacement preserves old runtime binding and stale roster cannot survive failed invalidation', async context => {
  const f = await fixture(context)
  const session = f.sessions.create('Failure', [{ assistantId: 1 }])
  f.models.bind(session.id, binding)
  f.db.connection.exec("CREATE TRIGGER fail_binding_update BEFORE UPDATE ON model_bindings BEGIN SELECT RAISE(ABORT, 'binding save failure'); END")
  assert.throws(() => f.models.bind(session.id, { ...binding, model: { ...model, id: 'replacement' } }), /save failure/)
  assert.equal(f.models.resolve(session.id)?.id, 'main')
  f.db.connection.exec("CREATE TRIGGER fail_binding_delete BEFORE DELETE ON model_bindings BEGIN SELECT RAISE(ABORT, 'binding delete failure'); END")
  f.sessions.setMetadata(session.id, [{ assistantId: 2 }])
  assert.throws(() => f.models.invalidateSession(session.id), /delete failure/)
  assert.equal(f.models.resolve(session.id), undefined)
  f.reopen()
  assert.equal(f.models.resolve(session.id), undefined)
})

test('closed session bindings become unavailable and local hosts cannot install Mon storage', async context => {
  const f = await fixture(context)
  const session = f.sessions.create('Closed', [{ assistantId: 1 }])
  f.models.bind(session.id, binding)
  f.sessions.setStatus(session.id, 'closed')
  assert.equal(f.models.resolve(session.id), undefined)
  assert.throws(() => new ModelService('local', model, new ModelBindingRepository(f.db)), /cannot restore Mon/)
})

test('binding and event commit together before runtime installation, with rollback on event failure', async context => {
  const f = await fixture(context)
  const session = f.sessions.create('Atomic binding', [{ assistantId: 1 }])
  f.models.bind(session.id, binding)
  const snapshot = { mode: 'single' as const, main: { ...binding, model: { ...model, id: 'next' } }, vision: null }
  let published = false
  f.sessions.events.subscribe(event => { if (event.kind === 'model.bound') published = true })
  f.db.connection.exec("CREATE TRIGGER reject_model_event BEFORE INSERT ON events WHEN NEW.kind='model.bound' BEGIN SELECT RAISE(ABORT, 'binding event failure'); END")
  const work = () => f.sessions.events.insert(session.id, null, 'model.bound', { model: 'next' })
  assert.throws(() => f.models.commitBinding(session.id, snapshot, work), /event failure/)
  assert.equal(f.models.resolve(session.id)?.id, 'main')
  assert.equal(f.sessions.events.list(session.id).filter(event => event.kind === 'model.bound').length, 0)
  assert.equal(published, false)
  f.db.connection.exec('DROP TRIGGER reject_model_event')
  const event = f.models.commitBinding(session.id, snapshot, work)
  assert.equal(f.models.resolve(session.id)?.id, 'next')
  assert.equal(published, false)
  f.sessions.events.publish(event)
  assert.equal(published, true)
  f.reopen()
  assert.equal(f.models.resolve(session.id)?.id, 'next')
})

test('outer transactions can save a binding with role metadata and roll both back without nesting', async context => {
  const f = await fixture(context)
  const session = f.sessions.create('Outer owner', [{ assistantId: 1 }])
  const repository = new ModelBindingRepository(f.db)
  const snapshot = { mode: 'single' as const, main: binding, vision: null }
  assert.throws(() => repository.saveInTransaction(session.id, snapshot), /owning transaction/)
  assert.throws(() => f.db.transaction(() => {
    f.sessions.events.insert(session.id, null, 'session.metadata.updated', { participants: [{ assistantId: 2 }] })
    repository.saveInTransaction(session.id, snapshot)
    throw new Error('Later handoff failure')
  }), /Later handoff failure/)
  assert.deepEqual(f.sessions.read(session.id).participants, [{ assistantId: 1 }])
  assert.equal(repository.read(session.id), undefined)
  assert.equal(f.db.inTransaction, false)
  f.db.transaction(() => {
    f.sessions.events.insert(session.id, null, 'session.metadata.updated', { participants: [{ assistantId: 2 }] })
    repository.saveInTransaction(session.id, snapshot)
  })
  assert.deepEqual(repository.read(session.id), snapshot)
})

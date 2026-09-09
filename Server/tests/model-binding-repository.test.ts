import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { ModelBindingRepository } from '../src/modules/models/index.ts'
import type { ModelBindingSnapshot } from '../src/modules/models/index.ts'

const model = { id: 'test', provider: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'private-model-key', contextWindow: 10000, maxTokens: 1000 }
const single: ModelBindingSnapshot = { mode: 'single', main: { model, entityId: 1, label: 'Main' }, vision: null }

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-model-bindings-'))
  const filename = path.join(root, 'test.sqlite')
  let db = new EdenDatabase(filename, 'mon')
  context.after(async () => { db.close(); await rm(root, { recursive: true, force: true }) })
  const sessions = new SessionRepository(db, 'mon')
  let bindings = new ModelBindingRepository(db)
  return { filename, sessions, get db() { return db }, get bindings() { return bindings },
    reopen() { db.close(); db = new EdenDatabase(filename, 'mon'); bindings = new ModelBindingRepository(db) } }
}

test('single and multi bindings survive disk reopen in private realm storage without credential events', async context => {
  const f = await fixture(context)
  const session = f.sessions.create('Bound', [{ assistantId: 1, characterId: 11 }])
  f.bindings.save(session.id, single)
  f.bindings.save('default', single)
  assert.ok(!JSON.stringify(f.sessions.events.list(session.id)).includes('private-model-key'))
  f.reopen()
  assert.deepEqual(f.bindings.read(session.id), single)
  if (process.platform !== 'win32') assert.equal((await stat(f.filename)).mode & 0o777, 0o600)
  const multi: ModelBindingSnapshot = { mode: 'multi', director: model, actors: [
    { assistantId: 1, characterId: 11, main: { model, entityId: 1, label: 'First' }, vision: null },
    { assistantId: 2, characterId: 22, main: { model, entityId: 2, label: 'Second' }, vision: { model, entityId: 3, label: 'Vision' } },
  ] }
  assert.throws(() => f.bindings.save(session.id, multi), /roster mismatch/)
  const multiSession = new SessionRepository(f.db, 'mon').create('Multiple', [{ assistantId: 1, characterId: 11 }, { assistantId: 2, characterId: 22 }])
  f.bindings.save(multiSession.id, multi)
  f.reopen()
  assert.deepEqual(f.bindings.read(multiSession.id), multi)
  assert.deepEqual(f.bindings.read('default'), single)
})

test('participant changes and session closure prevent restoring old bindings while environment changes preserve them', async context => {
  const f = await fixture(context)
  const session = f.sessions.create('Bound', [{ assistantId: 1, characterId: 11 }])
  f.bindings.save(session.id, single)
  f.sessions.setMetadata(session.id, undefined, { place: 'New place' })
  assert.deepEqual(f.bindings.read(session.id), single)
  f.sessions.setMetadata(session.id, [{ assistantId: 2, characterId: 22 }])
  assert.equal(f.bindings.read(session.id), undefined)
  f.bindings.save(session.id, single)
  f.sessions.setStatus(session.id, 'closed')
  assert.equal(f.bindings.read(session.id), undefined)
  assert.throws(() => f.bindings.save(session.id, single), /active session/)
})

test('failed replacement rolls back existing snapshot and malformed or oversized data cannot be stored', async context => {
  const f = await fixture(context)
  f.bindings.save('default', single)
  f.db.connection.exec("CREATE TRIGGER reject_binding BEFORE UPDATE ON model_bindings BEGIN SELECT RAISE(ABORT, 'binding disk failure'); END")
  assert.throws(() => f.bindings.save('default', { ...single, vision: model }), /disk failure/)
  assert.deepEqual(f.bindings.read('default'), single)
  assert.throws(() => f.bindings.save('default', { ...single, main: { model: { ...model, apiKey: 'x'.repeat(600000) }, entityId: 1, label: 'Large' } }), /size limit/)
  assert.throws(() => f.bindings.save('invalid', single))
  f.bindings.remove('default')
  assert.deepEqual(f.bindings.keys(), [])
  const local = new EdenDatabase(':memory:', 'local')
  try { assert.throws(() => new ModelBindingRepository(local), /Mon database/) } finally { local.close() }
})

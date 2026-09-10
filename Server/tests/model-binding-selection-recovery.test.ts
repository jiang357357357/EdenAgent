import { DatabaseSync } from 'node:sqlite'
import { migrations } from '@eden/store/testing'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { ModelBindingRepository, ModelService } from '../src/modules/models/index.ts'
import { MonOperationRepository } from '../src/modules/mon/operation-repository.ts'

const model = { id: 'old', provider: 'test', baseUrl: 'https://model.invalid/v1', contextWindow: 32000, maxTokens: 1024 }
const binding = { model, entityId: 1, label: 'Bound model' }

function fixture(context: test.TestContext) {
  const db = new EdenDatabase(':memory:', 'mon')
  context.after(() => db.close())
  const sessions = new SessionRepository(db, 'mon')
  const storage = new ModelBindingRepository(db)
  const models = new ModelService('mon', undefined, storage)
  const operations = new MonOperationRepository(sessions)
  const session = sessions.create('Selection recovery', [{ assistantId: 1 }])
  models.bind(session.id, binding)
  return { db, sessions, storage, models, operations, session }
}

test('selection intent immediately invalidates older binding and remains unavailable after restart recovery until refreshed', context => {
  const f = fixture(context)
  const operation = f.operations.begin(f.session.id, '/api/assistants/1/', {})
  assert.equal(f.models.resolve(f.session.id), undefined)
  assert.throws(() => f.models.bind(f.session.id, binding), /selection outcome/)
  const restored = new ModelService('mon', undefined, f.storage)
  assert.equal(restored.resolve(f.session.id), undefined)
  new MonOperationRepository(f.sessions)
  assert.equal(f.operations.list({ limit: 10 })[0] && (f.operations.list({ limit: 10 })[0] as { state: string }).state, 'unknown')
  assert.equal(restored.resolve(f.session.id), undefined)
  restored.bind(f.session.id, { ...binding, model: { ...model, id: 'confirmed' } })
  assert.equal(restored.resolve(f.session.id)?.id, 'confirmed')
  assert.equal(new ModelService('mon', undefined, f.storage).resolve(f.session.id)?.id, 'confirmed')
  assert.ok(operation)
})

test('rejected selection preserves the old binding but applied selection requires a fresh binding', context => {
  const f = fixture(context)
  const rejected = f.operations.begin(f.session.id, '/api/assistants/1/', {})
  f.operations.finish(rejected, 'failed', 'Mon rejected it')
  assert.equal(f.models.resolve(f.session.id)?.id, 'old')
  const applied = f.operations.begin(f.session.id, '/api/assistants/1/', {})
  f.operations.finish(applied, 'applied')
  assert.equal(f.models.resolve(f.session.id), undefined)
  f.models.bind(f.session.id, { ...binding, model: { ...model, id: 'new' } })
  assert.equal(f.models.resolve(f.session.id)?.id, 'new')
})

test('selection guard is scoped to its session or default binding and failed invalidation cannot revive stale data', context => {
  const f = fixture(context)
  const other = f.sessions.create('Other', [{ assistantId: 2 }])
  f.models.bind(other.id, binding)
  f.models.bind(undefined, binding)
  f.operations.begin(f.session.id, '/api/assistants/1/', {})
  f.db.connection.exec("CREATE TRIGGER reject_binding_delete BEFORE DELETE ON model_bindings BEGIN SELECT RAISE(ABORT, 'delete failure'); END")
  assert.throws(() => f.models.invalidateSession(f.session.id), /delete failure/)
  assert.equal(f.models.resolve(f.session.id), undefined)
  assert.equal(f.models.resolve(other.id)?.id, 'old')
  assert.equal(f.models.read().id, 'old')
  f.operations.begin(undefined, '/api/assistants/current/', {})
  assert.equal(f.models.read().available, false)
  assert.equal(f.models.resolve(other.id)?.id, 'old')
})

test('disk reopen and version-18 upgrade keep uncertain old bindings unavailable until a confirmed refresh', async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-selection-cursor-'))
  const filename = path.join(root, 'test.sqlite')
  let db = new EdenDatabase(filename, 'mon')
  context.after(async () => { db.close(); await rm(root, { recursive: true, force: true }) })
  const sessions = new SessionRepository(db, 'mon')
  const session = sessions.create('Upgrade source', [{ assistantId: 1 }])
  new ModelService('mon', undefined, new ModelBindingRepository(db)).bind(session.id, binding)
  new MonOperationRepository(sessions).begin(session.id, '/api/assistants/1/', {})
  const tables = ['sessions', 'model_bindings', 'mon_operations']
  const saved = new Map(tables.map(table => [table, db.connection.prepare(`SELECT * FROM ${table}`).all()]))
  db.close(); await rm(filename)
  const legacy = new DatabaseSync(filename)
  for (let index = 0; index < 18; index++) {
    legacy.exec(migrations[index]!)
    legacy.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(index + 1, Date.now())
  }
  legacy.exec("INSERT INTO realm_meta VALUES ('origin','mon'); PRAGMA user_version=18")
  for (const table of tables) {
    const columns = legacy.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name))
    for (const row of saved.get(table)!) legacy.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
      .run(...columns.map(column => row[column]!))
  }
  legacy.close(); db = new EdenDatabase(filename, 'mon')
  let models = new ModelService('mon', undefined, new ModelBindingRepository(db))
  assert.equal(models.resolve(session.id), undefined)
  new MonOperationRepository(new SessionRepository(db, 'mon'))
  models.bind(session.id, { ...binding, model: { ...model, id: 'confirmed-after-upgrade' } })
  db.close(); db = new EdenDatabase(filename, 'mon')
  models = new ModelService('mon', undefined, new ModelBindingRepository(db))
  assert.equal(models.resolve(session.id)?.id, 'confirmed-after-upgrade')
})

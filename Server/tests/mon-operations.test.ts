import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EdenDatabase } from '@eden/store'
import { ModelService } from '../src/modules/models/index.ts'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { MonBindingService } from '../src/modules/mon/index.ts'
import { MonOperationRepository } from '../src/modules/mon/operation-repository.ts'
import { modelRoutes } from '../src/transport/rpc/model.routes.ts'

test('Mon operation query filters durable outcomes without requiring Core credentials', async () => {
  const database = new EdenDatabase(':memory:', 'mon')
  const repository = new SessionRepository(database, 'mon')
  const models = new ModelService('mon')
  const sessions = new SessionService(repository, id => models.resolve(id))
  const mon = new MonBindingService(models, sessions)
  try {
    const first = repository.create('First')
    const second = repository.create('Second')
    const operations = new MonOperationRepository(repository)
    const applied = operations.begin(first.id, '/api/characters/1/', { body: { ai_talk_entity_id: 2 } })
    operations.finish(applied, 'applied')
    const uncertain = operations.begin(second.id, '/api/characters/2/', { body: { ai_talk_entity_id: 3 } })
    operations.finish(uncertain, 'unknown', 'Response lost')
    const global = operations.begin(undefined, '/api/agent/settings/my/', { body: { default_model: '4' } })
    operations.finish(global, 'failed', 'Request rejected')
    const list = modelRoutes(models, sessions, mon)['mon.operation.list']!
    const rows = await list({}) as Record<string, unknown>[]
    assert.equal(rows.length, 3)
    assert.equal(rows.find(row => row.operationId === global)?.sessionId, null)
    const filtered = await list({ sessionId: second.id, state: 'unknown' }) as Record<string, unknown>[]
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0]?.operationId, uncertain)
    assert.equal(filtered[0]?.error, 'Response lost')
    assert.deepEqual(await list({ sessionId: first.id, state: 'unknown' }), [])
    assert.equal((await list({ limit: 1 }) as unknown[]).length, 1)
    await assert.rejects(async () => list({ limit: 101 }))
    await assert.rejects(async () => list({ state: 'retry' }))
    await assert.rejects(async () => list({ sessionId: '00000000-0000-4000-8000-000000000000' }), /not found/)
    await mon.close()
    await assert.rejects(async () => list({}), /shutting down/)
  } finally { await mon.close(); await sessions.close(); database.close() }
})

test('Mon operation query is unavailable in the local realm', async () => {
  const database = new EdenDatabase(':memory:', 'local')
  const repository = new SessionRepository(database, 'local')
  const models = new ModelService('local')
  const sessions = new SessionService(repository, undefined)
  const mon = new MonBindingService(models, sessions)
  try {
    assert.equal(modelRoutes(models, sessions)['mon.operation.list'], undefined)
    assert.throws(() => mon.listOperations({ limit: 50 }), /only available in Mon/)
  } finally { await mon.close(); await sessions.close(); database.close() }
})

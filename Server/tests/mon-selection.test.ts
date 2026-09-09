import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EdenDatabase } from '@eden/store'
import { ModelService, ModelBindingRepository } from '../src/modules/models/index.ts'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { MonBindingService } from '../src/modules/mon/index.ts'
import { MonOperationRepository } from '../src/modules/mon/operation-repository.ts'

async function fixture(boundCharacter = true) {
  let selected = 1
  let mode: 'ok' | 'drop' | 'reject' | 'refresh-fail' = 'ok'
  const patches: unknown[] = []
  const entity = (id: number) => ({ id, ai_model: `model-${id}`, ai_name: `Model ${id}`, vendor: 'test', status: 'active',
    api_key: 'private-model-key', api_endpoint: 'https://model.invalid/v1', default_params: { context_window: 32000, max_tokens: 1024 } })
  const core = createServer(async (request, response) => {
    if (request.method === 'PATCH') {
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      const value = JSON.parse(body)
      patches.push(value)
      if (mode === 'reject') { response.writeHead(403).end(); return }
      selected = Number(value.ai_talk_entity_id ?? value.default_model)
      if (mode === 'drop') { request.socket.destroy(); return }
      response.end('{}'); return
    }
    if (mode === 'refresh-fail' && patches.length && request.url === '/api/ai/entities/') { response.writeHead(503).end(); return }
    const url = request.url ?? ''
    const body = url.startsWith('/api/assistants/') ? { id: 1, name: 'Assistant', character: { id: 1, name: 'Character', ai_talk_entity_id: boundCharacter ? selected : null } } :
      url === '/api/agent/settings/my/' ? { default_model: String(selected) } : url === '/api/core/vendors/ai/' ? { vendors: {} } :
        url === '/api/ai/entities/' ? [entity(1), entity(2)] : entity(Number(url.split('/').filter(Boolean).at(-1)))
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(body))
  })
  await new Promise<void>(resolve => core.listen(0, '127.0.0.1', resolve))
  const database = new EdenDatabase(':memory:', 'mon')
  const repository = new SessionRepository(database, 'mon')
  const models = new ModelService('mon', undefined, new ModelBindingRepository(database))
  const sessions = new SessionService(repository, id => models.resolve(id))
  const mon = new MonBindingService(models, sessions)
  const session = repository.create('Select model')
  const params = { sessionId: session.id, coreBaseUrl: `http://127.0.0.1:${(core.address() as AddressInfo).port}`, coreToken: 'private-core-token' }
  await mon.catalog(params)
  return { database, repository, models, mon, params, patches, setMode(value: typeof mode) { mode = value },
    async close() { await mon.close(); await sessions.close(); database.close(); core.closeAllConnections(); await new Promise<void>(resolve => core.close(() => resolve())) } }
}

test('Mon selection writes durable intent before PATCH and binds the refreshed model', async () => {
  const setup = await fixture()
  try {
    const seen: string[] = []
    setup.repository.events.subscribe(event => {
      if (event.kind === 'mon.operation.started') {
        assert.equal(setup.patches.length, 0)
        assert.equal(setup.database.connection.prepare("SELECT state FROM mon_operations").get()?.state, 'running')
        seen.push(event.kind)
      }
    })
    await setup.mon.select({ ...setup.params, aiEntityId: 2 })
    assert.equal(setup.models.read(setup.params.sessionId).id, 'model-2')
    assert.deepEqual(setup.patches, [{ ai_talk_entity_id: 2 }])
    assert.equal(setup.database.connection.prepare('SELECT state FROM mon_operations').get()?.state, 'applied')
    assert.deepEqual(seen, ['mon.operation.started'])
    assert.doesNotMatch(JSON.stringify(setup.database.connection.prepare('SELECT * FROM mon_operations').all()), /private-core-token|private-model-key/)
  } finally { await setup.close() }
})

test('intent write failure prevents the Mon mutation entirely', async () => {
  const setup = await fixture()
  try {
    setup.database.connection.exec("CREATE TRIGGER reject_intent BEFORE INSERT ON mon_operations BEGIN SELECT RAISE(ABORT, 'intent failure'); END")
    await assert.rejects(setup.mon.select({ ...setup.params, aiEntityId: 2 }), /intent failure/)
    assert.equal(setup.patches.length, 0)
    assert.equal(setup.models.read(setup.params.sessionId).id, 'model-1')
  } finally { await setup.close() }
})

test('an assistant identity mismatch prevents selection from writing another character', async () => {
  const setup = await fixture()
  try {
    setup.repository.setMetadata(setup.params.sessionId, [{ assistantId: 2 }])
    await assert.rejects(setup.mon.select({ ...setup.params, aiEntityId: 2 }), /identity mismatch/)
    assert.equal(setup.patches.length, 0)
    assert.equal(setup.database.connection.prepare('SELECT COUNT(*) AS count FROM mon_operations').get()?.count, 0)
  } finally { await setup.close() }
})

test('selection updates the user default when the character has no explicit model binding', async () => {
  const setup = await fixture(false)
  try {
    await setup.mon.select({ ...setup.params, aiEntityId: 2 })
    assert.deepEqual(setup.patches, [{ default_model: '2' }])
    assert.equal(setup.models.read(setup.params.sessionId).id, 'model-2')
  } finally { await setup.close() }
})

test('concurrent session selections serialize remote preference writes and retain their own bindings', async () => {
  const setup = await fixture()
  try {
    const second = setup.repository.create('Concurrent selection')
    await Promise.all([
      setup.mon.select({ ...setup.params, aiEntityId: 2 }),
      setup.mon.select({ ...setup.params, sessionId: second.id, aiEntityId: 1 }),
    ])
    assert.deepEqual(setup.patches, [{ ai_talk_entity_id: 2 }, { ai_talk_entity_id: 1 }])
    assert.equal(setup.models.read(setup.params.sessionId).id, 'model-2')
    assert.equal(setup.models.read(second.id).id, 'model-1')
  } finally { await setup.close() }
})

for (const [mode, expected] of [['drop', 'unknown'], ['reject', 'failed'], ['refresh-fail', 'applied']] as const) {
  test(`Mon selection ${mode} preserves outcome ${expected} without retry`, async () => {
    const setup = await fixture()
    try {
      setup.setMode(mode)
      await assert.rejects(setup.mon.select({ ...setup.params, aiEntityId: 2 }))
      assert.equal(setup.patches.length, 1)
      assert.equal(setup.database.connection.prepare('SELECT state FROM mon_operations').get()?.state, expected)
      assert.equal(setup.models.read(setup.params.sessionId).available, mode === 'reject')
      const operations = new MonOperationRepository(setup.repository)
      operations.begin(setup.params.sessionId, '/api/characters/1/', { ai_talk_entity_id: 1 })
      new MonOperationRepository(setup.repository)
      assert.equal(setup.database.connection.prepare("SELECT COUNT(*) AS count FROM mon_operations WHERE state='running'").get()?.count, 0)
      assert.equal(setup.patches.length, 1)
    } finally { await setup.close() }
  })
}

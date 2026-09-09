import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { EdenDatabase } from '@eden/store'
import { ModelService } from '../src/modules/models/index.ts'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { MonBindingService } from '../src/modules/mon/index.ts'
import { modelRoutes } from '../src/transport/rpc/model.routes.ts'

test('explicit actor and director selection preserve target identity, durable intent and unrelated bindings', async () => {
  const selected = new Map<number, number | null>([[1, 1], [2, null], [3, 1]])
  const patches: { url: string; body: unknown }[] = []
  const entity = (id: number) => ({ id, ai_model: `model-${id}`, ai_name: `Model ${id}`, vendor: 'test', status: 'active',
    api_key: 'private-key', api_endpoint: 'https://model.invalid/v1', default_params: { context_window: 32000, max_tokens: 1024 } })
  const db = new EdenDatabase(':memory:', 'mon')
  const core = createServer(async (request, response) => {
    const url = request.url ?? ''
    if (request.method === 'PATCH') {
      assert.equal(db.connection.prepare("SELECT COUNT(*) AS count FROM mon_operations WHERE state='running'").get()?.count, 1)
      let text = ''
      for await (const chunk of request) text += chunk.toString()
      const body = JSON.parse(text)
      patches.push({ url, body })
      selected.set(Number(url.split('/')[3]), body.ai_talk_entity_id)
      response.end('{}'); return
    }
    const id = url.includes('/current/') ? 3 : Number(url.split('/')[3])
    const body = url.startsWith('/api/assistants/') ? { id, name: `Actor ${id}`, character: { id, name: `Character ${id}`, ai_talk_entity_id: selected.get(id) } } :
      url === '/api/agent/settings/my/' ? { default_model: '1' } : url === '/api/core/vendors/ai/' ? { vendors: {} } :
        url === '/api/ai/entities/' ? [entity(1), entity(2)] : entity(Number(url.split('/').filter(Boolean).at(-1)))
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(body))
  })
  await new Promise<void>(resolve => core.listen(0, '127.0.0.1', resolve))
  const address = core.address()
  assert.ok(address && typeof address !== 'string')
  const repository = new SessionRepository(db, 'mon')
  const models = new ModelService('mon')
  const sessions = new SessionService(repository, id => models.resolve(id))
  const mon = new MonBindingService(models, sessions)
  const routes = modelRoutes(models, sessions, mon)
  const session = repository.create('Target selection', [{ assistantId: 1 }, { assistantId: 2 }])
  const params = { sessionId: session.id, coreBaseUrl: `http://127.0.0.1:${address.port}`, coreToken: 'private-token', aiEntityId: 2 }
  try {
    await mon.catalog(params)
    await assert.rejects(Promise.resolve(routes['model.select']!(params)), /explicit actor or director/)
    await assert.rejects(Promise.resolve(routes['model.select']!({ ...params, target: { kind: 'actor', assistantId: 99 } })), /belong/)
    assert.equal(patches.length, 0)
    db.connection.exec("CREATE TRIGGER reject_selection BEFORE INSERT ON mon_operations BEGIN SELECT RAISE(ABORT, 'intent failure'); END")
    await assert.rejects(Promise.resolve(routes['model.select']!({ ...params, target: { kind: 'actor', assistantId: 2 } })), /intent failure/)
    assert.equal(patches.length, 0)
    db.connection.exec('DROP TRIGGER reject_selection')
    await routes['model.select']!({ ...params, target: { kind: 'actor', assistantId: '2' } })
    assert.deepEqual(patches, [{ url: '/api/characters/2/', body: { ai_talk_entity_id: 2 } }])
    assert.equal(models.resolveActorModel(session.id, 1)?.id, 'model-1')
    assert.equal(models.resolveActorModel(session.id, 2)?.id, 'model-2')
    assert.equal(models.resolveDirector(session.id)?.id, 'model-1')
    await routes['model.select']!({ ...params, target: { kind: 'director' } })
    assert.deepEqual(patches[1], { url: '/api/characters/3/', body: { ai_talk_entity_id: 2 } })
    assert.equal(models.resolveDirector(session.id)?.id, 'model-2')
    assert.equal(models.resolveActorModel(session.id, 1)?.id, 'model-1')
    assert.equal(models.resolveActorModel(session.id, 2)?.id, 'model-2')
    assert.deepEqual(db.connection.prepare('SELECT state FROM mon_operations ORDER BY rowid').all().map(row => row.state), ['applied', 'applied'])
    assert.doesNotMatch(JSON.stringify(repository.events.list(session.id)), /private-key|private-token/)
  } finally {
    await mon.close(); await sessions.close(); db.close(); core.closeAllConnections()
    await new Promise<void>(resolve => core.close(() => resolve()))
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { ModelService } from '../src/modules/models/index.ts'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { modelRoutes } from '../src/transport/rpc/model.routes.ts'
import { MonBindingService } from '../src/modules/mon/index.ts'

test('Mon catalogues bind distinct session models without returning or persisting their credentials', async () => {
  const firstModel = await recordedModel([{ text: 'First model' }])
  const secondModel = await recordedModel([{ text: 'Second model' }])
  const entity = (id: number) => ({ id, ai_model: `model-${id}`, ai_name: `Model ${id}`, vendor: 'recorded', status: 'active',
    api_key: `private-key-${id}`, api_endpoint: id === 1 ? firstModel.config.baseUrl : secondModel.config.baseUrl,
    default_params: { context_window: 32000, max_tokens: 1024 }, is_multimodal: false })
  const core = createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Token test-core-token')
    const url = request.url ?? ''
    let body: unknown
    if (url.startsWith('/api/assistants/')) {
      const id = url.includes('/2/') ? 2 : 1
      body = { id, name: `Assistant ${id}`, character: { id, name: `Character ${id}`, ai_talk_entity_id: id } }
    } else if (url === '/api/agent/settings/my/') body = { default_model: '2' }
    else if (url === '/api/core/vendors/ai/') body = { vendors: { recorded: { name: 'Recorded', models: ['model-1', 'model-2'], api_key: 'vendor-secret' } } }
    else if (url === '/api/ai/entities/') body = [entity(1), entity(2)]
    else if (url === '/api/ai/entities/1/') body = entity(1)
    else if (url === '/api/ai/entities/2/') body = entity(2)
    else { response.writeHead(404).end(); return }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  })
  await new Promise<void>(resolve => core.listen(0, '127.0.0.1', resolve))
  const database = new EdenDatabase(':memory:', 'mon')
  const repository = new SessionRepository(database, 'mon')
  const models = new ModelService('mon')
  const sessions = new SessionService(repository, id => models.resolve(id))
  const mon = new MonBindingService(models, sessions)
  const routes = modelRoutes(models, sessions, mon)
  const params = { coreBaseUrl: `http://127.0.0.1:${(core.address() as AddressInfo).port}`, coreToken: 'test-core-token' }
  try {
    const first = repository.create('First', [{ assistantId: 1 }])
    const second = repository.create('Second', [{ assistantId: 2 }])
    assert.throws(() => sessions.start(first.id, 'No binding'), /No model configured/)
    const firstCatalog = await routes['model.catalog']!({ ...params, sessionId: first.id })
    const secondCatalog = await routes['model.catalog']!({ ...params, sessionId: second.id })
    assert.doesNotMatch(JSON.stringify([firstCatalog, secondCatalog]), /private-key|vendor-secret|test-core-token|api_key/)
    assert.equal(models.read(first.id).id, 'model-1')
    assert.equal(models.read(second.id).id, 'model-2')
    const prepared = await mon.prepareHandoff(first.id, 2, new AbortController().signal)
    assert.equal(prepared?.binding.model.id, 'model-2')
    assert.equal(models.read(first.id).id, 'model-1')
    const third = repository.create('Unbound')
    assert.equal(await mon.prepareHandoff(third.id, 2, new AbortController().signal), undefined)
    await assert.rejects(mon.resolveAssistant(third.id, { assistantId: 2 }, new AbortController().signal), /bind Mon credentials/)
    const resolvedAssistant = await mon.resolveAssistant(first.id, { assistantId: 2 }, new AbortController().signal)
    assert.equal(resolvedAssistant.summary.id, 2)
    assert.equal(models.read(first.id).id, 'model-1')
    await routes['model.catalog']!(params)
    assert.throws(() => sessions.start(third.id, 'Must not inherit default credentials'), /No model configured/)
    sessions.start(first.id, 'Use first model')
    sessions.start(second.id, 'Use second model')
    await Promise.all([sessions.waitForIdle(first.id), sessions.waitForIdle(second.id)])
    assert.equal(firstModel.requests.length, 1)
    assert.equal(secondModel.requests.length, 1)
    assert.equal(firstModel.requests[0]?.model, 'model-1')
    assert.equal(secondModel.requests[0]?.model, 'model-2')
    const multi = repository.create('Multiple actors', [{ assistantId: 2 }, { assistantId: 1 }])
    const actorCatalog = await routes['model.catalog']!({ ...params, sessionId: multi.id }) as Record<string, unknown>
    assert.equal((actorCatalog.actors as unknown[]).length, 2)
    assert.equal(models.resolveDirector(multi.id)?.id, 'model-1')
    assert.equal((actorCatalog.director as { aiEntityId: number }).aiEntityId, 1)
    assert.equal(models.resolveActor(multi.id, 1)?.main.model.id, 'model-1')
    assert.equal(models.resolveActor(multi.id, 2)?.main.model.id, 'model-2')
    assert.equal(models.resolveActor(first.id, 2), undefined)
    assert.doesNotMatch(JSON.stringify(actorCatalog), /private-key|vendor-secret|test-core-token|api_key/)
    assert.throws(() => sessions.start(multi.id, 'Do not collapse actors into one model'), /No model configured/)
    const missingActor = repository.create('Wrong identity', [{ assistantId: 1 }, { assistantId: 3 }])
    await assert.rejects(routes['model.catalog']!({ ...params, sessionId: missingActor.id }) as Promise<unknown>, /identity mismatch/)
    assert.equal(models.resolveActor(missingActor.id, 1), undefined)
    assert.ok(!repository.events.list(missingActor.id).some(event => event.kind === 'session.actor_models.bound'))
    const duplicate = repository.create('Duplicate actors', [{ assistantId: 1 }, { assistantId: '1' }])
    await assert.rejects(routes['model.catalog']!({ ...params, sessionId: duplicate.id }) as Promise<unknown>, /Duplicate/)
    database.connection.exec("CREATE TRIGGER reject_actor_binding BEFORE INSERT ON events WHEN NEW.kind='session.actor_models.bound' BEGIN SELECT RAISE(ABORT, 'actor disk failure'); END")
    const failedActors = repository.create('Disk failure', [{ assistantId: 1 }, { assistantId: 2 }])
    await assert.rejects(routes['model.catalog']!({ ...params, sessionId: failedActors.id }) as Promise<unknown>, /actor disk failure/)
    assert.equal(models.resolveActor(failedActors.id, 1), undefined)
    assert.equal(models.resolveActor(failedActors.id, 2), undefined)
    assert.doesNotMatch(JSON.stringify(repository.events.list(multi.id)), /private-key|test-core-token/)
    assert.doesNotMatch(JSON.stringify(repository.events.list(first.id, '0', 1000)), /private-key|test-core-token/)
    database.connection.exec("CREATE TRIGGER reject_binding BEFORE INSERT ON events WHEN NEW.kind='model.bound' BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
    await assert.rejects(routes['model.catalog']!({ ...params, sessionId: third.id }) as Promise<unknown>, /disk failure/)
    assert.equal(models.read(third.id).available, false)
    assert.equal(new ModelService('mon').read(first.id).available, false)
  } finally {
    await mon.close(); await sessions.close(); database.close()
    await Promise.all([firstModel.close(), secondModel.close()])
    core.closeAllConnections()
    await new Promise<void>(resolve => core.close(() => resolve()))
  }
})

test('shutdown cancels a pending Mon binding and releases its session configuration lock', async () => {
  let entered!: () => void
  const received = new Promise<void>(resolve => { entered = resolve })
  const core = createServer(() => { entered() })
  await new Promise<void>(resolve => core.listen(0, '127.0.0.1', resolve))
  const database = new EdenDatabase(':memory:', 'mon')
  const repository = new SessionRepository(database, 'mon')
  const models = new ModelService('mon')
  const sessions = new SessionService(repository, id => models.resolve(id))
  const mon = new MonBindingService(models, sessions)
  try {
    const session = repository.create('Pending binding')
    const binding = mon.catalog({ sessionId: session.id, coreBaseUrl: `http://127.0.0.1:${(core.address() as AddressInfo).port}`, coreToken: 'test-token' })
    const rejected = assert.rejects(binding)
    await received
    assert.throws(() => sessions.start(session.id, 'Do not race configuration'), /closed|closing|being/)
    await mon.close()
    await rejected
    assert.equal(models.read(session.id).available, false)
    assert.equal(await sessions.configureWhileIdle(session.id, async () => 'lock released'), 'lock released')
    assert.ok(!repository.events.list(session.id).some(event => event.kind === 'model.bound'))
  } finally {
    await mon.close(); await sessions.close(); database.close()
    core.closeAllConnections()
    await new Promise<void>(resolve => core.close(() => resolve()))
  }
})

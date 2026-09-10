import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EdenDatabase } from '@eden/store'
import { ModelService } from '../src/modules/models/index.ts'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { modelRoutes } from '../src/transport/rpc/model.routes.ts'
import { loadConfig } from '../src/bootstrap/config.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { recordedModel } from '@eden/runtime-pi/testing'

test('model status matches the legacy read contract without disclosing credentials', async () => {
  const model = { provider: 'openai', id: 'configured-model', baseUrl: 'https://api.openai.com/v1', apiKey: 'test-private-credential', contextWindow: 32000, maxTokens: 1024 }
  const models = new ModelService('local', model)
  const database = new EdenDatabase(':memory:', 'local')
  const sessions = new SessionService(new SessionRepository(database, 'local'), model)
  try {
    const session = sessions.repository.create('Model status')
    const routes = modelRoutes(models, sessions)
    const result = await routes['model.read']!({ sessionId: session.id }) as Record<string, unknown>
    assert.equal(result.id, model.id)
    assert.equal(result.source, 'env')
    assert.equal(result.available, true)
    assert.equal(result.contextWindow, 32000)
    assert.doesNotMatch(JSON.stringify(result), /apiKey|test-private-credential/)
    await assert.rejects(async () => routes['model.read']!({ sessionId: '00000000-0000-4000-8000-000000000000' }), /not found/)
    assert.equal(new ModelService('local').read().available, false)
    assert.equal(new ModelService('mon').read().available, false)
    assert.throws(() => new ModelService('mon', model), /Mon integration/)
  } finally { await sessions.close(); database.close() }
})

test('custom provider endpoints and credentials are explicit and configuration rejects secret-bearing URLs', () => {
  assert.throws(() => loadConfig({ EDEN_AGENT_MODEL: 'custom/model', OPENAI_API_KEY: 'unrelated' }), /BASE_URL/)
  const config = loadConfig({ EDEN_AGENT_MODEL: 'custom/model', EDEN_AGENT_BASE_URL: 'http://127.0.0.1:8888/v1', OPENAI_API_KEY: 'unrelated' })
  assert.equal(config.model?.apiKey, undefined)
  assert.equal(config.model?.baseUrl, 'http://127.0.0.1:8888/v1')
  for (const endpoint of ['https://user:secret@example.com/v1', 'https://example.com/v1?key=secret', 'http://remote.example/v1']) {
    assert.throws(() => loadConfig({ EDEN_AGENT_MODEL: 'custom/model', EDEN_AGENT_BASE_URL: endpoint }))
  }
  assert.throws(() => loadConfig({ EDEN_AGENT_MODEL: 'openai/model', EDEN_AGENT_CONTEXT_WINDOW: '100', EDEN_AGENT_MAX_TOKENS: '200' }), /budget/)
})

test('a recovered queued input cannot silently switch model endpoints', async () => {
  const first = await recordedModel([{ text: 'Original model' }])
  const second = await recordedModel([{ text: 'Changed model' }])
  const database = new EdenDatabase(':memory:', 'local')
  const repository = new SessionRepository(database, 'local')
  const session = repository.create('Pinned model')
  new InputRepository(database, repository.events).enqueue(session.id, 'Saved input', 'saved', { model: first.config })
  const sessions = new SessionService(repository, second.config)
  try {
    sessions.resumePending()
    await sessions.waitForIdle(session.id)
    assert.equal(first.requests.length + second.requests.length, 0)
    assert.equal(database.connection.prepare("SELECT state FROM inputs WHERE idempotency_key='saved'").get()?.state, 'interrupted')
    assert.match(JSON.stringify(repository.events.list(session.id)), /configuration changed/)
  } finally { await sessions.close(); database.close(); await Promise.all([first.close(), second.close()]) }
})

test('model.read reports every requested actor and cannot mask a missing binding with a session model', async () => {
  const database = new EdenDatabase(':memory:', 'mon')
  const repository = new SessionRepository(database, 'mon')
  const models = new ModelService('mon')
  const sessions = new SessionService(repository, id => models.resolve(id))
  const session = repository.create('Actor status', [{ assistantId: 1 }, { assistantId: 2 }])
  const config = { provider: 'test', id: 'model', baseUrl: 'https://model.invalid/v1', apiKey: 'private-key', contextWindow: 32000, maxTokens: 1024 }
  const binding = (id: number) => ({ assistantId: id, characterId: id, main: { model: config, entityId: id, label: `Actor ${id}` } })
  const read = modelRoutes(models, sessions)['model.read']!
  try {
    models.bind(session.id, binding(1).main)
    assert.equal((await read({ sessionId: session.id }) as { available: boolean }).available, false)
    models.bindActors(session.id, [binding(1)])
    const partial = await read({ sessionId: session.id }) as { available: boolean; actors: { available: boolean }[] }
    assert.equal(partial.available, false)
    assert.deepEqual(partial.actors.map(actor => actor.available), [true, false])
    models.bindActors(session.id, [binding(1), binding(2)])
    assert.equal((await read({ sessionId: session.id }) as { available: boolean }).available, false)
    assert.equal(models.resolveDirector(session.id), undefined)
    models.bindActors(session.id, [binding(1), binding(2)], binding(1).main.model)
    const ready = await read({ sessionId: session.id }) as { available: boolean; mode: string; actors: { assistantID: number }[] }
    assert.equal(ready.available, true)
    assert.equal(ready.mode, 'multi_actor')
    assert.deepEqual(ready.actors.map(actor => actor.assistantID), [1, 2])
    assert.doesNotMatch(JSON.stringify(ready), /private-key|apiKey/)
    assert.equal(models.resolve(session.id), undefined)
    models.invalidateSession(session.id)
    assert.equal((await read({ sessionId: session.id }) as { available: boolean }).available, false)
  } finally { await sessions.close(); database.close() }
})

test('local actor status uses local configuration but rejects invalid and duplicate rosters', () => {
  const config = { provider: 'test', id: 'model', baseUrl: 'https://model.invalid/v1', contextWindow: 32000, maxTokens: 1024 }
  const models = new ModelService('local', config)
  assert.equal(models.read('local-session', [{ assistantId: 1 }, { assistantId: 2 }]).available, true)
  assert.equal(models.read('local-session', [{ assistantId: 1 }, { assistantId: '1' }]).available, false)
  assert.equal(models.read('local-session', [{ assistantId: 1 }, {}]).available, false)
  assert.equal(models.read('local-session', Array.from({ length: 33 }, (_, assistantId) => ({ assistantId }))).available, false)
})

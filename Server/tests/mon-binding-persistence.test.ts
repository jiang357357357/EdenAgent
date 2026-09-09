import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { loadConfig } from '../src/bootstrap/config.ts'
import { createServices } from '../src/bootstrap/services.ts'

test('production Mon catalogue commits durable single/vision/actor/director bindings and restores them without another catalogue request', async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-mon-binding-restart-'))
  const model = await recordedModel([{ text: 'Restored model reply' }])
  let changed = false
  let expectedToken = 'private-core-token'
  let requests = 0
  const entity = (id: number) => ({ id, ai_model: changed && id === 1 ? 'changed-model' : `model-${id}`, ai_name: `Model ${id}`,
    vendor: 'recorded', status: 'active', api_key: `private-key-${id}`, api_endpoint: model.config.baseUrl,
    default_params: { context_window: 32000, max_tokens: 1024 }, is_multimodal: id === 3 })
  const core = createServer((request, response) => {
    requests++
    assert.equal(request.headers.authorization, `Token ${expectedToken}`)
    const url = request.url ?? ''
    const id = url.includes('/current/') ? 1 : Number(url.split('/').filter(Boolean).at(-1))
    const value = url.startsWith('/api/assistants/') ? { id, name: `Actor ${id}`, character: { id: id * 11, name: `Character ${id}`, ai_talk_entity_id: id, vision_ai_entity_id: 3 } } :
      url === '/api/agent/settings/my/' ? { default_model: '1' } : url === '/api/core/vendors/ai/' ? { vendors: {} } :
      url === '/api/ai/entities/' ? [entity(1), entity(2), entity(3)] : entity(id)
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value))
  })
  await new Promise<void>(resolve => core.listen(0, '127.0.0.1', resolve))
  const filename = path.join(root, 'test.sqlite')
  const config = loadConfig({ EDEN_AGENT_RUNTIME_ORIGIN: 'mon', EDEN_AGENT_V2_DATA_ROOT: root })
  let db = new EdenDatabase(filename, 'mon')
  let services = createServices(db, config)
  const close = async () => {
    await services.memoryExtractions.close()
    await Promise.all([services.sessions.close(), services.plugins.close(), services.mon.close(), services.companion.close()])
    services.questions.close(); db.close()
  }
  context.after(async () => { await close(); await model.close(); core.closeAllConnections(); await new Promise<void>(resolve => core.close(() => resolve())); await rm(root, { recursive: true, force: true }) })
  const single = services.repository.create('Single', [{ assistantId: 1 }])
  const multi = services.repository.create('Multiple', [{ assistantId: 1 }, { assistantId: 2 }])
  const params = { coreBaseUrl: `http://127.0.0.1:${(core.address() as AddressInfo).port}`, coreToken: 'private-core-token' }
  let observed = ''
  services.repository.events.subscribe(event => { if (event.kind === 'model.bound') observed = services.models.resolve(single.id)?.id ?? '' })
  const catalogue = await services.mon.catalog({ ...params, sessionId: single.id })
  assert.equal(observed, 'model-1')
  await services.mon.catalog({ ...params, sessionId: multi.id })
  assert.ok(!JSON.stringify(catalogue).includes('private-key'))
  db.connection.exec("CREATE TRIGGER reject_model_commit BEFORE INSERT ON events WHEN NEW.kind='model.bound' BEGIN SELECT RAISE(ABORT, 'model event disk failure'); END")
  changed = true
  expectedToken = 'rotated-core-token'
  await assert.rejects(services.mon.catalog({ ...params, coreToken: expectedToken, sessionId: single.id }), /disk failure/)
  expectedToken = 'private-core-token'
  assert.equal(services.models.resolve(single.id)?.id, 'model-1')
  db.connection.exec('DROP TRIGGER reject_model_commit')
  const count = requests
  await close()
  db = new EdenDatabase(filename, 'mon'); services = createServices(db, config)
  assert.equal(services.models.resolve(single.id)?.id, 'model-1')
  assert.equal(services.models.resolveVision(single.id)?.id, 'model-3')
  assert.equal(services.models.resolveActorModel(multi.id, 2)?.id, 'model-2')
  assert.equal(services.models.resolveActor(multi.id, 1)?.vision?.model.id, 'model-3')
  assert.equal(services.models.resolveDirector(multi.id)?.id, 'model-1')
  services.sessions.start(single.id, 'Continue after restart')
  await services.sessions.waitForIdle(single.id)
  assert.equal(model.requests.length, 1)
  assert.equal(model.requests[0]!.model, 'model-1')
  assert.equal(requests, count)
  const prepared = await services.mon.prepareHandoff(single.id, 2, new AbortController().signal)
  assert.equal(prepared?.binding.model.id, 'model-2')
  assert.ok(requests > count)
  assert.ok(!JSON.stringify(services.repository.events.list(single.id)).includes('private-key'))
  assert.ok(!JSON.stringify(services.repository.events.list(single.id)).includes('private-core-token'))
  services.repository.setStatus(single.id, 'closed')
  assert.equal(await services.mon.prepareHandoff(single.id, 2, new AbortController().signal), undefined)
})

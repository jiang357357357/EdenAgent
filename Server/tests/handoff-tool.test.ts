import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { createServices } from '../src/bootstrap/services.ts'
import { loadConfig } from '../src/bootstrap/config.ts'

for (const scenario of ['approved', 'deny-read', 'deny-handoff']) {
  const allowed = scenario === 'approved'
  test(`production switch_assistant ${allowed ? 'schedules the approved target and resumes as it' : `does not schedule after ${scenario}`}`, { timeout: 15000 }, async t => {
    const first = await recordedModel([{ tool: 'switch_assistant', input: { assistantId: 2 } }, { text: 'Original assistant finishes' }])
    t.after(() => first.close())
    const next = await recordedModel([{ text: 'New assistant begins' }])
    t.after(() => next.close())
    const root = await mkdtemp(path.join(os.tmpdir(), 'eden-handoff-tool-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const db = new EdenDatabase(':memory:', 'mon')
    const entity = (id: number) => ({ id, ai_model: `model-${id}`, ai_name: `Model ${id}`, vendor: 'recorded', status: 'active',
      api_key: 'MODEL_CREDENTIAL', api_endpoint: id === 1 ? first.config.baseUrl : next.config.baseUrl,
      default_params: { context_window: 32000, max_tokens: 1024 } })
    let targetReads = 0
    const core = createServer((request, response) => {
      assert.equal(request.method, 'GET')
      const url = request.url ?? ''
      if (url === '/api/assistants/2/') targetReads++
      const id = Number(url.split('/').filter(Boolean).at(-1))
      const body = url.startsWith('/api/assistants/') ? { id, name: `Assistant ${id}`, private_token: 'PROFILE_CREDENTIAL',
        character: { id, name: `Character ${id}`, ai_talk_entity_id: id, system_prompt: 'TARGET_PERSONA',
          personality: { core: 'Speak calmly', api_key: 'NESTED_CREDENTIAL' }, avatar_url: '/avatar.png' } } :
        url === '/api/agent/settings/my/' ? { default_model: '1' } : url === '/api/core/vendors/ai/' ? { vendors: {} } :
          url === '/api/ai/entities/' ? [entity(1), entity(2)] : entity(id)
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(body))
    })
    await new Promise<void>(resolve => core.listen(0, '127.0.0.1', resolve))
    t.after(async () => { core.closeAllConnections(); await new Promise<void>(resolve => core.close(() => resolve())) })
    const address = core.address(); assert.ok(address && typeof address !== 'string')
    const services = createServices(db, loadConfig({ EDEN_AGENT_RUNTIME_ORIGIN: 'mon', EDEN_AGENT_V2_DATA_ROOT: root }))
    const session = services.repository.create('Switch tool', [{ assistantId: 1 }])
    const approvals: string[] = []
    services.repository.events.subscribe(event => {
      if (event.kind !== 'permission.requested') return
      const pending = services.permissions.list(session.id).find(item => item.state === 'pending')!
      approvals.push(pending.capability)
      assert.equal(db.connection.prepare('SELECT COUNT(*) AS count FROM assistant_handoffs').get()?.count, 0)
      services.permissions.resolve(pending.id, pending.capability === 'mon.assistants.read' ? scenario !== 'deny-read' : allowed)
    })
    try {
      await services.mon.catalog({ sessionId: session.id, coreBaseUrl: `http://127.0.0.1:${address.port}`, coreToken: 'CORE_CREDENTIAL' })
      services.sessions.start(session.id, 'Switch to assistant 2')
      await services.sessions.waitForIdle(session.id)
      assert.equal(services.sessions.faultCount(), 0)
      assert.deepEqual(approvals, scenario === 'deny-read' ? ['mon.assistants.read'] : ['mon.assistants.read', 'assistant.handoff'])
      if (scenario === 'deny-read') assert.equal(targetReads, 0)
      assert.equal(first.requests.length, 2)
      assert.equal(next.requests.length, allowed ? 1 : 0)
      assert.equal(db.connection.prepare('SELECT COUNT(*) AS count FROM assistant_handoffs').get()?.count, allowed ? 1 : 0)
      if (allowed) {
        assert.equal(db.connection.prepare('SELECT state FROM assistant_handoffs').get()?.state, 'completed')
        assert.match(JSON.stringify(next.requests[0]), /TARGET_PERSONA|Speak calmly/)
        assert.match(JSON.stringify(next.requests[0]), /Original assistant finishes/)
      }
      const events = JSON.stringify(services.repository.events.list(session.id, '0', 1000))
      assert.doesNotMatch(events, /PROFILE_CREDENTIAL|NESTED_CREDENTIAL|MODEL_CREDENTIAL|CORE_CREDENTIAL/)
      const toolResults = services.repository.events.list(session.id, '0', 1000).filter(event => event.kind === 'operation.completed')
      assert.doesNotMatch(JSON.stringify(toolResults), /TARGET_PERSONA|Speak calmly/)
    } finally {
      await Promise.all([services.sessions.close(), services.mon.close(), services.plugins.close(), services.companion.close()])
      services.questions.close(); db.close()
    }
  })
}

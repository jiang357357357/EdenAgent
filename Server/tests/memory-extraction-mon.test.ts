import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { loadConfig } from '../src/bootstrap/config.ts'
import { createServices } from '../src/bootstrap/services.ts'

async function until(check: () => boolean) {
  const deadline = Date.now() + 10000
  while (!check() && Date.now() < deadline) await delay(10)
  assert.ok(check(), 'Multi-actor extraction did not settle')
}

test('Mon multi-actor extraction uses each accepted actor model and keeps candidates and approvals in its character scope', async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-memory-mon-'))
  const db = new EdenDatabase(':memory:', 'mon')
  const services = createServices(db, loadConfig({ EDEN_AGENT_RUNTIME_ORIGIN: 'mon', EDEN_AGENT_V2_DATA_ROOT: root }))
  const director = await recordedModel([{ text: '{"beats":[{"assistantId":1},{"assistantId":2}]}' }])
  const first = await recordedModel([{ text: 'FIRST_PUBLIC_REPLY' }, { text: '{"memories":[{"kind":"fact","content":"FIRST_CANDIDATE","confidence":0.95}]}' }])
  const second = await recordedModel([{ text: 'SECOND_PUBLIC_REPLY' }, { text: '{"memories":[{"kind":"fact","content":"SECOND_CANDIDATE","confidence":0.95}]}' }])
  context.after(async () => {
    await services.memoryExtractions.close()
    await Promise.all([services.sessions.close(), services.plugins.close(), services.mon.close(), services.companion.close()])
    services.questions.close(); db.close()
    await Promise.all([director.close(), first.close(), second.close()])
    await rm(root, { recursive: true, force: true })
  })
  await services.memoryExtractions.start()
  const session = services.repository.create('Multi-actor memory', [{ assistantId: 1, characterId: 11 }, { assistantId: 2, characterId: 22 }])
  services.models.bindActors(session.id, [
    { assistantId: 1, characterId: 11, main: { model: first.config, entityId: 1, label: 'First' } },
    { assistantId: 2, characterId: 22, main: { model: second.config, entityId: 2, label: 'Second' } },
  ], director.config)
  services.sessions.start(session.id, 'Both reply')
  await services.sessions.waitForIdle(session.id)
  await until(() => services.permissions.list(session.id).filter(item => item.state === 'pending').length === 2)
  const page = services.memoryExtractions.candidates(session.id)
  assert.deepEqual(page.items.map(item => item.scopeKey).sort(), ['11', '22'])
  assert.equal(first.requests.length, 2)
  assert.equal(second.requests.length, 2)
  assert.equal(director.requests.length, 1)
  assert.match(JSON.stringify(first.requests[1]), /FIRST_PUBLIC_REPLY/)
  assert.ok(!JSON.stringify(first.requests[1]).includes('SECOND_PUBLIC_REPLY'))
  assert.match(JSON.stringify(second.requests[1]), /SECOND_PUBLIC_REPLY/)
  assert.ok(!JSON.stringify(second.requests[1]).includes('FIRST_PUBLIC_REPLY'))
  for (const request of services.permissions.list(session.id)) {
    const details = request.details as { actorId: string }
    services.permissions.resolve(request.id, details.actorId === '1')
  }
  await until(() => services.memories.search({ scopeType: 'agent_character', scopeKey: '11' }).length === 1)
  await until(() => services.memoryExtractions.candidates(session.id).items.every(item => !item.processing))
  assert.equal(services.memories.search({ scopeType: 'agent_character', scopeKey: '11' })[0]!.content, 'FIRST_CANDIDATE')
  assert.deepEqual(services.memories.search({ scopeType: 'agent_character', scopeKey: '22' }), [])
  assert.equal(services.memoryExtractions.candidates(session.id).items[0]!.actorId, '2')
  assert.equal(services.memoryExtractions.fault, undefined)
})

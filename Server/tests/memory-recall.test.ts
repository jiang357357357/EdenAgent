import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { loadConfig } from '../src/bootstrap/config.ts'
import { createServices } from '../src/bootstrap/services.ts'
import { selectMemories } from '../src/modules/memories/index.ts'

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-memory-recall-'))
  const db = new EdenDatabase(':memory:', 'mon')
  const services = createServices(db, loadConfig({ EDEN_AGENT_RUNTIME_ORIGIN: 'mon', EDEN_AGENT_V2_DATA_ROOT: root }))
  context.after(async () => {
    await Promise.all([services.sessions.close(), services.plugins.close(), services.companion.close(), services.mon.close()])
    services.questions.close(); db.close(); await rm(root, { recursive: true, force: true })
  })
  return { db, services }
}

test('production multi-actor recall and search stay in each acting character scope', async context => {
  const f = await fixture(context)
  const director = await recordedModel([{ text: '{"beats":[{"assistantId":1},{"assistantId":2}]}' }])
  const first = await recordedModel([{ tool: 'search_memories', input: {} }, { text: 'First public response' }])
  const second = await recordedModel([{ tool: 'search_memories', input: {} }, { text: 'Second public response' }])
  context.after(() => Promise.all([director.close(), first.close(), second.close()]))
  const session = f.services.repository.create('Private recall', [{ assistantId: 1, characterId: 11 }, { assistantId: 2, characterId: 22 }])
  f.services.models.bindActors(session.id, [
    { assistantId: 1, characterId: 11, main: { model: first.config, entityId: 1, label: 'First' } },
    { assistantId: 2, characterId: 22, main: { model: second.config, entityId: 2, label: 'Second' } },
  ], director.config)
  f.services.memories.create({ scopeType: 'agent_character', scopeKey: '11' }, 'FIRST_PRIVATE_MEMORY')
  f.services.memories.create({ scopeType: 'agent_character', scopeKey: '22' }, 'SECOND_PRIVATE_MEMORY')
  f.services.sessions.start(session.id, 'Both reply')
  await f.services.sessions.waitForIdle(session.id)
  assert.equal(f.services.sessions.faultCount(), 0)
  assert.equal(first.requests.length, 2)
  assert.equal(second.requests.length, 2)
  assert.match(JSON.stringify(first.requests[0]), /FIRST_PRIVATE_MEMORY/)
  assert.match(JSON.stringify(second.requests[0]), /SECOND_PRIVATE_MEMORY/)
  assert.ok(!JSON.stringify(first.requests).includes('SECOND_PRIVATE_MEMORY'))
  assert.ok(!JSON.stringify(second.requests).includes('FIRST_PRIVATE_MEMORY'))
  assert.ok(!JSON.stringify(director.requests).includes('PRIVATE_MEMORY'))
  const messages = f.services.repository.events.messages(session.id, undefined, 100).items
  assert.ok(!JSON.stringify(messages).includes('PRIVATE_MEMORY'))
  assert.match(JSON.stringify(second.requests[1]), /First public response/)
})

test('single-actor recall refreshes between turns and a storage failure blocks the next request', async context => {
  const f = await fixture(context)
  const model = await recordedModel([{ text: 'First response' }, { text: 'Second response' }])
  context.after(() => model.close())
  const session = f.services.repository.create('Refresh recall', [{ assistantId: 1, characterId: 11 }])
  f.services.models.bind(session.id, { model: model.config, entityId: 1, label: 'Memory model' })
  const scope = { scopeType: 'agent_character' as const, scopeKey: '11' }
  const initial = f.services.memories.create(scope, 'REMEMBERED_MARKER')
  f.services.sessions.start(session.id, 'First turn')
  await f.services.sessions.waitForIdle(session.id)
  assert.match(JSON.stringify(model.requests[0]), /REMEMBERED_MARKER/)
  f.services.memories.forget(scope, initial.id, initial.updatedAt)
  f.services.sessions.start(session.id, 'Second turn')
  await f.services.sessions.waitForIdle(session.id)
  assert.ok(!JSON.stringify(model.requests[1]).includes('REMEMBERED_MARKER'))
  f.db.connection.exec('ALTER TABLE memories RENAME TO broken_memories')
  f.services.sessions.start(session.id, 'Must not request a model')
  await f.services.sessions.waitForIdle(session.id)
  assert.equal(model.requests.length, 2)
  assert.equal(f.services.sessions.faultCount(), 1)
})

test('recall prioritizes query fragments and bounds count and Unicode content without changing stored records', async context => {
  const f = await fixture(context)
  const scope = { scopeType: 'agent_character' as const, scopeKey: '11' }
  f.services.memories.create(scope, '用户偏好简洁回答 ' + '😀'.repeat(1400))
  for (let index = 0; index < 8; index++) f.services.memories.create(scope, `Other ${index} ` + '字'.repeat(1400))
  const candidates = f.services.memories.search(scope, '', 100)
  const saved = JSON.stringify(candidates)
  const selected = selectMemories(candidates, '请简洁一点')
  assert.match(selected[0]!.content, /简洁回答/)
  assert.ok(selected.length <= 5)
  assert.ok(selected.every(memory => Array.from(memory.content).length <= 1200))
  assert.equal(selected.reduce((total, memory) => total + Array.from(memory.content).length, 0), 4000)
  assert.equal(JSON.stringify(candidates), saved)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import os from 'node:os'
import path from 'node:path'
import { recordedModel } from '@eden/runtime-pi/testing'
import { loadConfig } from '../src/bootstrap/config.ts'
import { startServer } from '../src/bootstrap/container.ts'
import { MemoryRepository } from '../src/modules/memories/index.ts'

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000
  while (!check() && Date.now() < deadline) await delay(10)
  assert.ok(check(), 'Production extraction boundary was not reached')
}

async function fixture(context: test.TestContext, replies?: Parameters<typeof recordedModel>[0]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-extraction-service-'))
  const model = await recordedModel(replies ?? [{ text: 'I will remember your preference.' },
    { text: '{"memories":[{"kind":"preference","content":"User prefers tea","confidence":0.95}]}' }])
  const config = { ...loadConfig({ EDEN_AGENT_RUNTIME_ORIGIN: 'local', EDEN_AGENT_V2_DATA_ROOT: root, EDEN_AGENT_PORT: '0' }), model: model.config }
  let server = await startServer(config)
  context.after(async () => { await server.close().catch(() => {}); await model.close(); await rm(root, { recursive: true, force: true }) })
  return { model, get server() { return server }, async restart() { await server.close(); server = await startServer(config) } }
}

test('production host extracts after completed turn, persists actual request and saves only after approval', async context => {
  const f = await fixture(context)
  const session = f.server.sessions.repository.create('Automatic memory', [{ assistantId: 1, characterId: 11 }])
  f.server.sessions.start(session.id, 'I prefer tea')
  await f.server.sessions.waitForIdle(session.id)
  await until(() => f.server.permissions.list().some(item => item.state === 'pending'))
  const request = f.server.permissions.list().find(item => item.state === 'pending')!
  assert.equal(request.capability, 'memory.write')
  const memories = new MemoryRepository(f.server.sessions.repository.database)
  const scope = { scopeType: 'agent_character' as const, scopeKey: '11' }
  assert.deepEqual(memories.search(scope), [])
  assert.equal(f.model.requests.length, 2)
  const audit = f.server.sessions.repository.events.list(session.id).filter(event => event.kind === 'memory.extraction.model_request')
  assert.equal(audit.length, 1)
  f.server.permissions.resolve(request.id, true)
  await until(() => memories.search(scope).length === 1)
  assert.equal(memories.search(scope)[0]!.content, 'User prefers tea')
  assert.equal((await fetch(`http://127.0.0.1:${f.server.port}/readyz`)).status, 200)
  await f.restart()
  await delay(30)
  assert.equal(f.model.requests.length, 2)
  assert.equal(new MemoryRepository(f.server.sessions.repository.database).search(scope).length, 1)
  assert.equal(f.server.permissions.list().filter(item => item.state === 'pending').length, 0)
})

test('production shutdown cancels extraction approval and restart preserves candidates without another model request', async context => {
  const f = await fixture(context)
  const session = f.server.sessions.repository.create('Pending memory', [{ assistantId: 1, characterId: 11 }])
  f.server.sessions.start(session.id, 'I prefer tea')
  await until(() => f.server.permissions.list().some(item => item.state === 'pending'))
  const row = f.server.sessions.repository.database.connection.prepare('SELECT id FROM memory_extractions').get()!
  await f.restart()
  assert.equal(f.server.memoryExtractions.jobs.read(String(row.id)).state, 'candidates')
  assert.equal(f.server.permissions.list()[0]!.state, 'cancelled')
  assert.equal(f.model.requests.length, 2)
})

test('production extraction scheduling faults make readiness fail and remain visible at shutdown', async context => {
  const f = await fixture(context)
  f.server.sessions.repository.database.connection.exec("CREATE TRIGGER deny_extraction BEFORE INSERT ON memory_extractions BEGIN SELECT RAISE(ABORT, 'extraction ledger failure'); END")
  const session = f.server.sessions.repository.create('Faulting memory', [{ assistantId: 1, characterId: 11 }])
  f.server.sessions.start(session.id, 'I prefer tea')
  await f.server.sessions.waitForIdle(session.id)
  assert.match(String(f.server.memoryExtractions.fault), /ledger failure/)
  assert.equal((await fetch(`http://127.0.0.1:${f.server.port}/readyz`)).status, 503)
  assert.equal(f.model.requests.length, 1)
  await assert.rejects(f.server.close(), /shutdown completed with errors/)
})

test('closing or deleting one session cancels its approval while another session continues', async context => {
  const replies = Array.from({ length: 3 }, () => [
    { text: 'A public reply' }, { text: '{"memories":[{"kind":"fact","content":"A confirmed fact","confidence":0.95}]}' },
  ]).flat()
  const f = await fixture(context, replies)
  for (const state of ['closed', 'deleted'] as const) {
    const session = f.server.sessions.repository.create('End during approval', [{ assistantId: 1, characterId: 11 }])
    f.server.sessions.start(session.id, 'A fact')
    await until(() => f.server.permissions.list(session.id).some(item => item.state === 'pending'))
    await f.server.sessions.endSession(session.id, state)
    assert.equal(f.server.permissions.list(session.id)[0]!.state, 'cancelled')
  }
  const remaining = f.server.sessions.repository.create('Continuing session', [{ assistantId: 2, characterId: 22 }])
  f.server.sessions.start(remaining.id, 'A confirmed fact')
  await until(() => f.server.permissions.list(remaining.id).some(item => item.state === 'pending'))
  f.server.permissions.resolve(f.server.permissions.list(remaining.id)[0]!.id, true)
  const memories = new MemoryRepository(f.server.sessions.repository.database)
  await until(() => memories.search({ scopeType: 'agent_character', scopeKey: '22' }).length === 1)
  assert.deepEqual(memories.search({ scopeType: 'agent_character', scopeKey: '11' }), [])
  assert.equal(f.model.requests.length, 6)
  assert.equal((await fetch(`http://127.0.0.1:${f.server.port}/readyz`)).status, 200)
})

test('ending a session cancels an extraction already waiting for the model and persists interrupted state', async context => {
  const f = await fixture(context, [{ text: 'Public reply' }, { wait: true }])
  const session = f.server.sessions.repository.create('Close during extraction', [{ assistantId: 1, characterId: 11 }])
  f.server.sessions.start(session.id, 'A fact')
  await until(() => f.model.requests.length === 2)
  const row = f.server.sessions.repository.database.connection.prepare('SELECT id FROM memory_extractions').get()!
  await f.server.sessions.endSession(session.id, 'closed')
  await until(() => f.server.memoryExtractions.jobs.read(String(row.id)).state === 'interrupted')
  assert.deepEqual(f.server.permissions.list(session.id), [])
  assert.equal(f.server.memoryExtractions.fault, undefined)
})

test('candidate RPC resumes persisted candidates with exact revision and session without another model request', async context => {
  const f = await fixture(context)
  const session = f.server.sessions.repository.create('Resume candidate', [{ assistantId: 1, characterId: 11 }])
  f.server.sessions.start(session.id, 'I prefer tea')
  await until(() => f.server.permissions.list(session.id).some(item => item.state === 'pending'))
  await f.restart()
  const { memoryExtractionRoutes } = await import('../src/transport/rpc/memory-extraction.routes.ts')
  const routes = memoryExtractionRoutes(f.server.memoryExtractions)
  const page = f.server.memoryExtractions.candidates(session.id)
  const item = page.items[0]!
  assert.equal(item.processing, false)
  assert.ok(!Object.hasOwn(item, 'userText'))
  assert.ok(!Object.hasOwn(item, 'assistantText'))
  assert.deepEqual(await routes['memory.extraction.candidates']!({ sessionId: session.id }), page)
  const params = { sessionId: session.id, jobId: item.id, revision: item.revision }
  await assert.rejects(async () => routes['memory.extraction.resume']!({ ...params, revision: '0'.repeat(64) }), /changed/)
  const other = f.server.sessions.repository.create('Other session')
  await assert.rejects(async () => routes['memory.extraction.resume']!({ ...params, sessionId: other.id }), /belong/)
  await assert.rejects(async () => routes['memory.extraction.resume']!({ ...params, candidates: [] }))
  assert.deepEqual(await routes['memory.extraction.resume']!(params), { jobId: item.id, state: 'accepted' })
  assert.deepEqual(await routes['memory.extraction.resume']!(params), { jobId: item.id, state: 'accepted' })
  assert.equal(f.server.memoryExtractions.candidates(session.id).items[0]!.processing, true)
  await until(() => f.server.permissions.list(session.id).some(value => value.state === 'pending'))
  const requests = f.server.permissions.list(session.id)
  assert.equal(requests.length, 2)
  f.server.permissions.resolve(requests.find(value => value.state === 'pending')!.id, true)
  await until(() => f.server.memoryExtractions.jobs.read(item.id).state === 'completed')
  assert.equal(f.model.requests.length, 2)
  assert.deepEqual(f.server.memoryExtractions.candidates(session.id).items, [])
})

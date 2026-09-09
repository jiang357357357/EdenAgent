import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { loadConfig } from '../src/bootstrap/config.ts'
import { createServices } from '../src/bootstrap/services.ts'
import { MemoryScopes, memoryTools } from '../src/modules/memories/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-memory-tools-'))
  const db = new EdenDatabase(':memory:', 'local')
  const model = await recordedModel([{ tool: 'remember_memory', input: { content: 'User prefers tea', kind: 'preference' } },
    { tool: 'search_memories', input: {} }, { text: 'Finished memory request' }])
  const services = createServices(db, { ...loadConfig({ EDEN_AGENT_V2_DATA_ROOT: root }), model: model.config })
  context.after(async () => {
    await Promise.all([services.sessions.close(), services.plugins.close(), services.companion.close(), services.mon.close()])
    services.questions.close(); db.close(); await model.close(); await rm(root, { recursive: true, force: true })
  })
  return { db, model, services }
}

for (const allowed of [true, false]) {
  test(`production remember_memory ${allowed ? 'commits after approval' : 'leaves no memory after denial'}`, async context => {
    const f = await fixture(context)
    const scope = { scopeType: 'agent_character' as const, scopeKey: '7' }
    const session = f.services.repository.create('Memory', [{ assistantId: 1, characterId: 7 }])
    let approvals = 0
    f.services.repository.events.subscribe(event => {
      if (event.kind !== 'permission.requested') return
      const request = f.services.permissions.list(session.id).find(item => item.state === 'pending')!
      approvals++
      assert.equal(request.capability, 'memory.write')
      assert.match(request.resource, /character:7/)
      assert.equal(f.services.memories.search(scope).length, 0)
      f.services.permissions.resolve(request.id, allowed)
    })
    f.services.sessions.start(session.id, 'Remember my preference')
    await f.services.sessions.waitForIdle(session.id)
    assert.equal(approvals, 1)
    assert.equal(f.services.sessions.faultCount(), 0)
    const memories = f.services.memories.search(scope)
    assert.equal(memories.length, allowed ? 1 : 0)
    if (allowed) {
      assert.equal(memories[0]?.sourceSessionId, session.id)
      assert.equal(memories[0]?.content, 'User prefers tea')
      const messages = f.model.requests[2]!.messages as { role: string; content: string }[]
      const result = JSON.parse(messages.filter(message => message.role === 'tool').at(-1)!.content)
      assert.equal(result[0].scopeKey, '7')
    }
  })
}

test('memory tools use the actual actor scope, enforce subagent read-only access and reject changes during approval', async context => {
  const f = await fixture(context)
  const participants = [{ assistantId: 1, characterId: 11 }, { assistantId: 2, profile: { character: { id: 22 } } }]
  const session = f.services.repository.create('Actor scopes', participants)
  const inputs = new InputRepository(f.db, f.services.repository.events)
  inputs.enqueue(session.id, 'Scoped memory', 'manual', { participants })
  const input = inputs.claim(session.id)!
  const scopes = new MemoryScopes(f.db)
  assert.throws(() => scopes.current(session.id, input.turnId), /actor identity/)
  assert.equal(scopes.current(session.id, input.turnId, 2).scopeKey, '22')
  const scope = { scopeType: 'agent_character' as const, scopeKey: '22' }
  const initial = f.services.memories.create(scope, 'Original')
  const make = (actorId: number, agentPath = '/root') => memoryTools(f.services.memories, scopes, f.services.permissions,
    { sessionId: session.id, turnId: input.turnId, actorId, agentPath })
  const execute = (tools: ReturnType<typeof make>, name: string, args: Record<string, unknown>) => tools.find(tool => tool.name === name)!.execute(args,
    { callId: 'memory-call', signal: new AbortController().signal })
  assert.deepEqual(await execute(make(1), 'search_memories', {}), [])
  assert.equal((await execute(make(2, '/root/child'), 'search_memories', {}) as unknown[]).length, 1)
  await assert.rejects(execute(make(2, '/root/child'), 'forget_memory', { id: initial.id }), /Subagents/)
  await assert.rejects(execute(make(1), 'forget_memory', { id: initial.id }), /scope/)
  f.services.repository.events.subscribe(event => {
    if (event.kind !== 'permission.requested') return
    const request = f.services.permissions.list(session.id).find(item => item.state === 'pending')!
    f.services.memories.update(scope, initial.id, initial.updatedAt, 'Concurrent correction')
    f.services.permissions.resolve(request.id, true)
  })
  await assert.rejects(execute(make(2), 'update_memory', { id: initial.id, content: 'Stale correction' }), /changed/)
  assert.equal(f.services.memories.read(scope, initial.id).content, 'Concurrent correction')
  inputs.finish(input)
  await assert.rejects(execute(make(2), 'search_memories', {}), /active input/)
})

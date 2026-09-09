import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { EdenDatabase } from '@eden/store'
import { createRuntime } from '@eden/runtime-pi'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository, runtimeCallbacks } from '../src/modules/sessions/index.ts'
import { ActorCheckpointRepository } from '../src/modules/actors/index.ts'

test('actors keep distinct checkpoints and tool operation identities within one turn', async () => {
  const first = await recordedModel([{ tool: 'echo', input: { value: 'first-only' } }, { text: 'First reply' }])
  const second = await recordedModel([{ tool: 'echo', input: { value: 'second-only' } }, { text: 'Second reply' }])
  const db = new EdenDatabase(':memory:', 'local')
  const sessions = new SessionRepository(db, 'local')
  const snapshots = new ActorCheckpointRepository(sessions)
  const session = sessions.create('Actor histories')
  const turnId = randomUUID()
  const planId = randomUUID()
  const calls: string[] = []
  try {
    for (const [assistantId, model] of [[1, first], [2, second]] as const) {
      const runtime = createRuntime({ sessionId: session.id, model: model.config, systemPrompt: `Actor ${assistantId}`,
        toolCallPrefix: `${planId}:${assistantId}:`,
        tools: [{ name: 'echo', revision: '1', description: 'echo', parameters: { type: 'object', properties: { value: { type: 'string' } } },
          async execute(input, context) { calls.push(context.callId); return String(input.value) } }],
        callbacks: runtimeCallbacks(sessions, { id: randomUUID(), sessionId: session.id, turnId, text: 'Respond', state: 'running' }, {
          actor: { assistantID: assistantId, planID: planId, beatIndex: assistantId - 1 },
          checkpoint: async snapshot => snapshots.save(session.id, assistantId, turnId, snapshot),
        }),
      })
      await runtime.prompt('Respond')
    }
    assert.deepEqual(calls, [`${planId}:1:call-1`, `${planId}:2:call-1`])
    const operations = db.connection.prepare('SELECT id, state FROM tool_operations').all()
    assert.equal(operations.length, 2)
    assert.ok(operations.every(operation => operation.state === 'completed'))
    const one = snapshots.read(session.id, 1)!
    const two = snapshots.read(session.id, 2)!
    assert.match(JSON.stringify(one), /first-only/)
    assert.doesNotMatch(JSON.stringify(one), /second-only/)
    assert.match(JSON.stringify(two), /second-only/)
    assert.doesNotMatch(JSON.stringify(two), /first-only/)
    assert.equal(sessions.checkpoint(session.id), undefined)
    assert.equal(snapshots.read(sessions.create('Other').id, 1), undefined)
    assert.throws(() => snapshots.save(session.id, 1, turnId, { ...one, sessionId: randomUUID() }), /mismatch/)
    const event = sessions.events.list(session.id, '0', 1000).find(item => item.kind === 'operation.started')!
    assert.equal((event.payload as { actor: { assistantID: number } }).actor.assistantID, 1)
    db.connection.exec("CREATE TRIGGER reject_actor_snapshot BEFORE INSERT ON events WHEN NEW.kind='actor.checkpoint' BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
    assert.throws(() => snapshots.save(session.id, 1, turnId, { ...one, entries: [] }), /disk failure/)
    assert.deepEqual(snapshots.read(session.id, 1), one)
  } finally { db.close(); await Promise.all([first.close(), second.close()]) }
})

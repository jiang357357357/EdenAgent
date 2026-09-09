import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { MemoryExtractionRepository, MemoryExtractionEvents } from '../src/modules/memories/index.ts'

function fixture(context: test.TestContext) {
  const db = new EdenDatabase(':memory:', 'local')
  const sessions = new SessionRepository(db, 'local')
  const inputs = new InputRepository(db, sessions.events)
  const jobs = new MemoryExtractionRepository(db)
  let wakes = 0
  let closes = 0
  const queue = { wake() { wakes++ }, async close() { closes++ }, cancelSession(_sessionId: string) {}, fault: undefined }
  const bridge = new MemoryExtractionEvents(sessions.events, jobs, queue)
  context.after(async () => { await bridge.close().catch(() => {}); db.close() })
  const create = () => {
    const participants = [{ assistantId: 1, characterId: 11 }]
    const session = sessions.create('Extraction event', participants)
    inputs.enqueue(session.id, 'Source', randomUUID(), { participants })
    const input = inputs.claim(session.id)!
    sessions.events.append(session.id, input.turnId, 'agent.message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'Reply' }] } })
    return input
  }
  return { db, sessions, inputs, jobs, bridge, create, get wakes() { return wakes }, get closes() { return closes } }
}

test('durable completion creates a task before wake; duplicate events do not duplicate extraction', async context => {
  const f = fixture(context)
  const input = f.create()
  assert.equal(f.wakes, 0)
  f.inputs.finish(input)
  assert.equal(f.jobs.queued().items.length, 1)
  assert.equal(f.wakes, 1)
  f.sessions.events.append(input.sessionId, input.turnId, 'turn.completed', { inputId: input.id })
  assert.equal(f.jobs.queued().items.length, 1)
  assert.equal(f.wakes, 2)
  f.sessions.events.append(input.sessionId, null, 'model.bound', {})
  f.sessions.events.append(input.sessionId, null, 'session.actor_models.bound', {})
  assert.equal(f.wakes, 4)
  await f.bridge.close()
  const later = f.create()
  f.inputs.finish(later)
  assert.equal(f.jobs.queued().items.length, 1)
  assert.equal(f.wakes, 4)
  assert.equal(f.closes, 1)
})

test('interrupted completion does not schedule or wake extraction', context => {
  const f = fixture(context)
  f.inputs.finish(f.create(), 'Cancelled')
  assert.equal(f.wakes, 0)
  assert.deepEqual(f.jobs.queued().items, [])
})

test('mismatched completion ownership faults the bridge and closes its queue without creating a task', async context => {
  const f = fixture(context)
  const input = f.create()
  f.sessions.events.append(input.sessionId, randomUUID(), 'turn.completed', { inputId: input.id })
  assert.match(String(f.bridge.fault), /ownership mismatch/)
  await assert.rejects(f.bridge.close(), /ownership mismatch/)
  assert.equal(f.closes, 1)
  assert.equal(f.wakes, 0)
  assert.deepEqual(f.jobs.queued().items, [])
})

test('task persistence failure remains visible even though event subscribers isolate exceptions', async context => {
  const f = fixture(context)
  const input = f.create()
  f.db.connection.exec("CREATE TRIGGER reject_extraction BEFORE INSERT ON memory_extractions BEGIN SELECT RAISE(ABORT, 'schedule disk failure'); END")
  f.inputs.finish(input)
  assert.match(String(f.bridge.fault), /disk failure/)
  await assert.rejects(f.bridge.close(), /disk failure/)
  assert.equal(f.closes, 1)
  assert.equal(f.wakes, 0)
  assert.deepEqual(f.jobs.queued().items, [])
})

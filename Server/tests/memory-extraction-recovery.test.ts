import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { MemoryExtractionRepository, recoverMemoryExtractions } from '../src/modules/memories/index.ts'

function fixture(context: test.TestContext) {
  const db = new EdenDatabase(':memory:', 'local')
  context.after(() => db.close())
  const sessions = new SessionRepository(db, 'local')
  const inputs = new InputRepository(db, sessions.events)
  const jobs = new MemoryExtractionRepository(db)
  const create = (kind: 'prompt' | 'compact' = 'prompt', error?: string) => {
    const participants = [{ assistantId: 1, characterId: 11 }]
    const session = sessions.create('Recovery source', participants)
    inputs.enqueue(session.id, 'Source', randomUUID(), { participants }, kind)
    const input = inputs.claim(session.id)!
    sessions.events.append(session.id, input.turnId, 'agent.message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'Reply' }] } })
    inputs.finish(input, error)
    return input
  }
  return { db, sessions, jobs, create, signal: new AbortController().signal }
}

test('recovery fills missed completion tasks over pages, preserves candidates and interrupts only claimed jobs', async context => {
  const f = fixture(context)
  const sources = Array.from({ length: 5 }, () => f.create())
  const running = f.jobs.schedule(sources[0]!.id)!
  f.jobs.claim(running.id)
  const candidate = f.jobs.schedule(sources[1]!.id)!
  f.jobs.claim(candidate.id)
  const saved = f.jobs.saveCandidates(candidate.id, [{ kind: 'fact', content: 'A candidate', confidence: 0.9 }])
  const first = await recoverMemoryExtractions(f.jobs, f.signal, 2)
  assert.deepEqual(first, { interrupted: 1, inputs: 5, tasks: 5 })
  assert.equal(f.jobs.read(running.id).state, 'interrupted')
  assert.deepEqual(f.jobs.read(candidate.id), saved)
  const ids = f.jobs.queued().items.map(job => job.id)
  assert.equal(ids.length, 3)
  assert.deepEqual(await recoverMemoryExtractions(f.jobs, f.signal, 1), { interrupted: 0, inputs: 5, tasks: 5 })
  assert.deepEqual(f.jobs.queued().items.map(job => job.id), ids)
})

test('recovery excludes compact, interrupted and closed sources and validates bounds before mutation', async context => {
  const f = fixture(context)
  f.create('compact')
  f.create('prompt', 'Cancelled')
  const closed = f.create()
  f.sessions.setStatus(closed.sessionId, 'closed')
  assert.deepEqual(await recoverMemoryExtractions(f.jobs, f.signal), { interrupted: 0, inputs: 0, tasks: 0 })
  const queued = f.jobs.schedule(f.create().id)!
  f.jobs.claim(queued.id)
  await assert.rejects(recoverMemoryExtractions(f.jobs, f.signal, 0), /page size/)
  assert.equal(f.jobs.read(queued.id).state, 'extracting')
  assert.throws(() => f.jobs.completedInputs('-1'), /bounds/)
})

test('cancelled partial recovery preserves committed jobs and a later scan completes without duplicates', async context => {
  const f = fixture(context)
  Array.from({ length: 4 }, () => f.create())
  const controller = new AbortController()
  const partial = { recover: () => f.jobs.recover(), completedInputs: (after?: string, limit?: number) => f.jobs.completedInputs(after, limit),
    scheduleInput(inputId: string) {
      const result = f.jobs.scheduleInput(inputId)
      controller.abort(new Error('Recovery cancelled'))
      return result
    } }
  await assert.rejects(recoverMemoryExtractions(partial, controller.signal, 2), /cancelled/)
  const first = f.jobs.queued().items[0]!.id
  assert.equal(f.jobs.queued().items.length, 1)
  await recoverMemoryExtractions(f.jobs, f.signal, 2)
  assert.equal(f.jobs.queued().items.length, 4)
  assert.equal(f.jobs.queued().items[0]!.id, first)
})

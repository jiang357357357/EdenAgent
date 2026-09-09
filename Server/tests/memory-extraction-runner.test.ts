import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { PermissionService } from '../src/modules/permissions/index.ts'
import { MemoryRepository, MemoryExtractionRepository, MemoryExtractionCommitRepository, MemoryExtractionRunner } from '../src/modules/memories/index.ts'
import { MemoryExtractionQueue } from '../src/modules/memories/index.ts'

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000
  while (!check() && Date.now() < deadline) await delay(10)
  assert.ok(check(), 'Expected asynchronous boundary was not reached')
}

async function fixture(context: test.TestContext, wait = false, failCapture = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-extraction-runner-'))
  const db = new EdenDatabase(path.join(root, 'test.sqlite'), 'local')
  const model = await recordedModel(wait ? [{ wait: true }] : [{ text: '{"memories":[{"kind":"fact","content":"Likes tea","confidence":0.95}]}' }])
  const sessions = new SessionRepository(db, 'local')
  const inputs = new InputRepository(db, sessions.events)
  const jobs = new MemoryExtractionRepository(db)
  const permissions = new PermissionService(db, sessions.events)
  const runner = new MemoryExtractionRunner(jobs, new MemoryExtractionCommitRepository(db), permissions, {
    async resolve() { return model.config },
    async record(job, snapshot) {
      assert.equal(model.requests.length, 0)
      if (failCapture) throw new Error('capture disk failure')
      sessions.events.append(job.sessionId, job.turnId, 'memory.extraction.model_request', { jobId: job.id, snapshot })
    },
  }, 1)
  context.after(async () => { await runner.close(); await model.close(); db.close(); await rm(root, { recursive: true, force: true }) })
  const create = () => {
    const participants = [{ assistantId: 1, characterId: 11 }]
    const session = sessions.create('Extraction runner', participants)
    inputs.enqueue(session.id, 'User fact', 'source', { participants })
    const input = inputs.claim(session.id)!
    sessions.events.append(session.id, input.turnId, 'agent.message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'Assistant reply' }] } })
    inputs.finish(input)
    return jobs.schedule(input.id)!
  }
  return { db, model, jobs, permissions, runner, create, memories: new MemoryRepository(db), scope: { scopeType: 'agent_character' as const, scopeKey: '11' } }
}

test('runner persists candidates before approval, coalesces execution and commits the returned durable approval ID', async context => {
  const f = await fixture(context)
  const job = f.create()
  const signal = new AbortController().signal
  const pending = f.runner.run(job.id, signal)
  assert.equal(f.runner.run(job.id, signal), pending)
  await until(() => f.permissions.list().some(item => item.state === 'pending'))
  assert.equal(f.jobs.read(job.id).state, 'candidates')
  assert.equal(f.memories.search(f.scope).length, 0)
  const request = f.permissions.list()[0]!
  f.permissions.resolve(request.id, true)
  const ids = await pending
  assert.equal(ids.length, 1)
  assert.equal(f.model.requests.length, 1)
  assert.equal(f.jobs.read(job.id).state, 'completed')
  assert.deepEqual(await f.runner.run(job.id, signal), ids)
  assert.equal(f.model.requests.length, 1)
})

test('denied candidates remain durable and explicit resume only asks approval without another model request', async context => {
  const f = await fixture(context)
  const job = f.create()
  const pending = f.runner.run(job.id, new AbortController().signal)
  const rejected = assert.rejects(pending, /Permission denied/)
  await until(() => f.permissions.list().length === 1)
  f.permissions.resolve(f.permissions.list()[0]!.id, false)
  await rejected
  assert.equal(f.jobs.read(job.id).state, 'candidates')
  const resumed = f.runner.run(job.id, new AbortController().signal)
  await until(() => f.permissions.list().length === 2)
  f.permissions.resolve(f.permissions.list().find(item => item.state === 'pending')!.id, true)
  await resumed
  assert.equal(f.model.requests.length, 1)
})

test('shutdown cancels live extraction, drains requests and leaves a non-replayable interrupted job', async context => {
  const f = await fixture(context, true)
  const job = f.create()
  const pending = f.runner.run(job.id, new AbortController().signal)
  const rejected = assert.rejects(pending, /closing/)
  await until(() => f.model.requests.length === 1)
  await assert.rejects(f.runner.run(f.create().id, new AbortController().signal), /busy/)
  await f.runner.close()
  await rejected
  assert.equal(f.jobs.read(job.id).state, 'interrupted')
  assert.equal(f.permissions.list().length, 0)
  await assert.rejects(f.runner.run(job.id, new AbortController().signal), /closed/)
})

test('audit failure prevents model transmission and records failed extraction without a permission request', async context => {
  const f = await fixture(context, false, true)
  const job = f.create()
  await assert.rejects(f.runner.run(job.id, new AbortController().signal), /persistence failed/)
  assert.equal(f.jobs.read(job.id).state, 'failed')
  assert.equal(f.model.requests.length, 0)
  assert.equal(f.permissions.list().length, 0)
})

test('shutdown during approval cancels its durable request and preserves candidates without writing memory', async context => {
  const f = await fixture(context)
  const job = f.create()
  const pending = f.runner.run(job.id, new AbortController().signal)
  const rejected = assert.rejects(pending, /Permission cancelled/)
  await until(() => f.permissions.list().length === 1)
  await f.runner.close()
  await rejected
  assert.equal(f.permissions.list()[0]!.state, 'cancelled')
  assert.equal(f.jobs.read(job.id).state, 'candidates')
  assert.deepEqual(f.memories.search(f.scope), [])
})

test('missing model binding leaves the task queued for later binding restoration', async context => {
  const f = await fixture(context)
  const job = f.create()
  const runner = new MemoryExtractionRunner(f.jobs, new MemoryExtractionCommitRepository(f.db), f.permissions, {
    async resolve() { throw new Error('Model binding not restored') }, async record() { assert.fail('Must not record without a model') },
  })
  try {
    await assert.rejects(runner.run(job.id, new AbortController().signal), /not restored/)
    assert.equal(f.jobs.read(job.id).state, 'queued')
    assert.equal(f.model.requests.length, 0)
  } finally { await runner.close() }
})

test('real queue shutdown drains approval and leaves unstarted source jobs queued', async context => {
  const f = await fixture(context)
  const first = f.create()
  const second = f.create()
  const failures: unknown[] = []
  const queue = new MemoryExtractionQueue(f.jobs, f.runner, (_id, error) => failures.push(error), 1)
  try {
    queue.wake()
    await until(() => f.permissions.list().length === 1)
    assert.equal(f.jobs.read(first.id).state, 'candidates')
    assert.equal(f.jobs.read(second.id).state, 'queued')
    await queue.close()
    assert.equal(f.permissions.list()[0]!.state, 'cancelled')
    assert.equal(f.jobs.read(second.id).state, 'queued')
    assert.equal(f.model.requests.length, 1)
    assert.deepEqual(f.memories.search(f.scope), [])
    assert.deepEqual(failures, [])
  } finally { await queue.close() }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { EdenDatabase } from '@eden/store'
import type { JsonValue } from '@eden/api'
import { recordedModel } from '@eden/runtime-pi/testing'
import { ModelService } from '../src/modules/models/index.ts'
import { SessionRepository, modelDescriptor } from '../src/modules/sessions/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { MemoryExtractionRepository, MemoryExtractionModels } from '../src/modules/memories/index.ts'

async function fixture(context: test.TestContext) {
  const db = new EdenDatabase(':memory:', 'mon')
  const model = await recordedModel([])
  context.after(async () => { db.close(); await model.close() })
  const sessions = new SessionRepository(db, 'mon')
  const inputs = new InputRepository(db, sessions.events)
  const jobs = new MemoryExtractionRepository(db)
  const models = new ModelService('mon')
  const resolver = new MemoryExtractionModels(jobs, models)
  const create = (multi: boolean, snapshot?: JsonValue) => {
    const participants = multi ? [{ assistantId: 1, characterId: 11 }, { assistantId: 2, characterId: 22 }] : [{ assistantId: 1, characterId: 11 }]
    const session = sessions.create('Extraction models', participants)
    const descriptor = snapshot ?? modelDescriptor(model.config)
    inputs.enqueue(session.id, 'Source user', 'source', { participants, ...(multi ? {
      companion: { actors: [{ assistantId: '1', model: descriptor }, { assistantId: '2', model: { ...modelDescriptor(model.config), id: 'other' } }] },
    } : { model: descriptor }) })
    const input = inputs.claim(session.id)!
    sessions.events.append(session.id, input.turnId, 'agent.message_end', {
      actor: { assistantID: 1 }, message: { role: 'assistant', content: [{ type: 'text', text: 'Final reply' }] },
    })
    inputs.finish(input)
    return jobs.schedule(input.id, 1)!
  }
  return { db, model, models, resolver, jobs, create, signal: new AbortController().signal }
}

test('single source requires restored exact binding, permits credential rotation and returns a detached model', async context => {
  const f = await fixture(context)
  const job = f.create(false)
  await assert.rejects(f.resolver.resolve(job, f.signal), /not restored/)
  const bind = (id = f.model.config.id) => f.models.bind(job.sessionId, { model: { ...f.model.config, id, apiKey: 'rotated-key' }, entityId: 1, label: 'main' })
  bind('different')
  await assert.rejects(f.resolver.resolve(job, f.signal), /changed/)
  bind()
  const resolved = await f.resolver.resolve(job, f.signal)
  assert.equal(resolved.apiKey, 'rotated-key')
  resolved.id = 'caller mutation'
  assert.equal((await f.resolver.resolve(job, f.signal)).id, f.model.config.id)
  assert.equal(f.jobs.read(job.id).state, 'queued')
  assert.equal(f.model.requests.length, 0)
})

test('multi source resolves its actor rather than the single or director model and checks that actor snapshot', async context => {
  const f = await fixture(context)
  const job = f.create(true)
  f.models.bind(job.sessionId, { model: f.model.config, entityId: 1, label: 'wrong slot' })
  await assert.rejects(f.resolver.resolve(job, f.signal), /not restored/)
  f.models.bindActors(job.sessionId, [1, 2].map(assistantId => ({ assistantId, characterId: assistantId * 11,
    main: { model: { ...f.model.config, id: assistantId === 1 ? f.model.config.id : 'other' }, entityId: assistantId, label: 'actor' },
  })), { ...f.model.config, id: 'director-only' })
  assert.equal((await f.resolver.resolve(job, f.signal)).id, f.model.config.id)
  f.db.connection.prepare('UPDATE inputs SET metadata_json=? WHERE id=?').run(JSON.stringify({ participants: [{ assistantId: 1, characterId: 11 }, { assistantId: 2, characterId: 22 }],
    companion: { actors: [{ assistantId: '2', model: modelDescriptor(f.model.config) }] },
  }), job.inputId)
  await assert.rejects(f.resolver.resolve(job, f.signal), /missing or ambiguous/)
})

test('missing source descriptors and cancellation never fall back to a currently available model', async context => {
  const f = await fixture(context)
  const job = f.create(false, {})
  f.models.bind(job.sessionId, { model: f.model.config, entityId: 1, label: 'main' })
  await assert.rejects(f.resolver.resolve(job, f.signal), /changed/)
  const controller = new AbortController()
  controller.abort(new Error('Cancelled model resolution'))
  await assert.rejects(f.resolver.resolve(job, controller.signal), /Cancelled/)
  assert.equal(f.model.requests.length, 0)
})

test('model resolution revalidates persisted source and ignores caller-supplied ownership changes', async context => {
  const f = await fixture(context)
  const job = f.create(false)
  f.models.bind(job.sessionId, { model: f.model.config, entityId: 1, label: 'main' })
  const result = await f.resolver.resolve({ ...job, actorId: '99', sessionId: 'untrusted' }, f.signal)
  assert.equal(result.id, f.model.config.id)
  f.db.connection.prepare('UPDATE inputs SET text=? WHERE id=?').run('Changed source', job.inputId)
  await assert.rejects(f.resolver.resolve(job, f.signal), /source changed/)
  assert.equal(f.model.requests.length, 0)
})

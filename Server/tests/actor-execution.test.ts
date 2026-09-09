import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { ActorExecutionService } from '../src/modules/actors/index.ts'
import { parseDirectorPlan } from '../src/modules/director/index.ts'
import { wireEvent } from '../src/transport/rpc/session.routes.ts'

test('actor execution restores its history and receives previous public replies without duplicate user messages', async () => {
  const model = await recordedModel([{ text: 'My first reply' }, { text: 'My next reply' }])
  const db = new EdenDatabase(':memory:', 'local')
  const sessions = new SessionRepository(db, 'local')
  const session = sessions.create('Actor execution')
  let actors = new ActorExecutionService(sessions)
  const plan = parseDirectorPlan('{}', [{ assistantId: 1 }], 'test')
  const request = { input: { id: randomUUID(), sessionId: session.id, turnId: randomUUID(), text: 'First question', state: 'running', metadata: { environment: { timezone: 'UTC', location: { city: 'Saved city', latitude: 31.234567, longitude: 121.456789 } } } },
    plan, beatIndex: 0, participant: { assistantId: 1, assistantName: 'One', characterName: 'One', avatarUrl: 'https://example.invalid/one.png', profile: { apiKey: 'private-profile' } },
    model: model.config, tools: [], conversation: [], signal: new AbortController().signal }
  try {
    sessions.setMetadata(session.id, undefined, { timezone: 'Asia/Shanghai' })
    await actors.execute(request)
    await actors.close()
    actors = new ActorExecutionService(sessions)
    await actors.execute({ ...request, input: { ...request.input, id: randomUUID(), turnId: randomUUID(), text: 'Continue' },
      conversation: [{ assistantID: 2, text: 'Other participant public reply' }] })
    assert.equal(model.requests.length, 2)
    assert.match(JSON.stringify(model.requests[1]), /UTC/)
    assert.doesNotMatch(JSON.stringify(model.requests[1]), /Asia\/Shanghai|latitude|longitude|31\.234567|121\.456789/)
    assert.match(JSON.stringify(model.requests[1]), /Saved city/)
    assert.match(JSON.stringify(model.requests[1]?.messages), /My first reply/)
    assert.match(JSON.stringify(model.requests[1]?.messages), /Other participant public reply/)
    const messages = sessions.events.messages(session.id, undefined, 100).items
    assert.equal(messages.length, 2)
    assert.ok(messages.every(event => JSON.stringify(event.payload).includes('"assistantID":1')))
    assert.ok(!messages.some(event => JSON.stringify(event.payload).includes('"role":"user"')))
    assert.doesNotMatch(JSON.stringify(messages), /private-profile|apiKey/)
    const script = fileURLToPath(new URL('../../Script/Project/verify_director_frontend.mjs', import.meta.url))
    const projected = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', script], {
      input: JSON.stringify({ sessionId: session.id, events: messages.map(wireEvent), output: 'messages' }), encoding: 'utf8', timeout: 15000,
    }))
    assert.equal(projected.length, 2)
    for (const message of projected) {
      assert.equal(message.speaker.assistantID, 1)
      assert.equal(message.speaker.assistantName, 'One')
      assert.equal(message.speaker.avatarUrl, 'https://example.invalid/one.png')
      assert.equal(message.orchestration.planID, plan.planID)
      assert.equal(message.orchestration.beatIndex, 0)
    }
    await assert.rejects(actors.execute({ ...request, participant: { assistantId: 2 } }), /does not match/)
    assert.equal(model.requests.length, 2)
  } finally { await actors.close(); db.close(); await model.close() }
})

test('actor shutdown cancels and drains a live request and concurrent actors are rejected', async () => {
  const model = await recordedModel([{ wait: true }])
  const db = new EdenDatabase(':memory:', 'local')
  const sessions = new SessionRepository(db, 'local')
  const actors = new ActorExecutionService(sessions)
  const session = sessions.create('Cancel actor')
  const request = { input: { id: randomUUID(), sessionId: session.id, turnId: randomUUID(), text: 'Wait', state: 'running' },
    plan: parseDirectorPlan('{}', [{ assistantId: 1 }], 'test'), beatIndex: 0, participant: { assistantId: 1 },
    model: model.config, tools: [], conversation: [], signal: new AbortController().signal }
  const task = actors.execute(request)
  const rejected = assert.rejects(task)
  try {
    await assert.rejects(actors.execute(request), /already executing/)
    const deadline = Date.now() + 5000
    while (!model.requests.length && Date.now() < deadline) await delay(10)
    assert.equal(model.requests.length, 1)
    await actors.close()
    await rejected
    await assert.rejects(actors.execute(request), /shutting down/)
    assert.equal(model.requests.length, 1)
  } finally { await actors.close(); await rejected; db.close(); await model.close() }
})

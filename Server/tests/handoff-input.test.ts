import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { HandoffRepository, HandoffCommitRepository } from '../src/modules/handoffs/index.ts'

// Exercises committed handoff inputs through the production session executor; scheduling is tested separately.
test('internal handoff input executes without becoming a public or future model user message', async () => {
  const model = await recordedModel([{ text: 'Hello from the new assistant' }, { text: 'Answer to real user' }])
  const db = new EdenDatabase(':memory:', 'mon')
  const repository = new SessionRepository(db, 'mon')
  const session = repository.create('Internal handoff', [{ assistantId: 1 }])
  const inputs = new InputRepository(db, repository.events)
  const handoffs = new HandoffRepository(repository)
  let service = new SessionService(repository, model.config)
  try {
    inputs.enqueue(session.id, 'Switch assistant', 'source')
    const source = inputs.claim(session.id)!
    const handoff = handoffs.schedule(session.id, source.turnId, { assistantId: 2 })
    inputs.finish(source); handoffs.claim(session.id)
    const committed = new HandoffCommitRepository(repository, handoffs).commit(handoff.id, model.config, 'PRIVATE_INTERNAL_GREETING')
    for (const event of committed.events) repository.events.publish(event)
    service.resumePending(); await service.waitForIdle(session.id)
    assert.equal(service.faultCount(), 0)
    const messages = repository.events.messages(session.id, undefined, 100).items
    assert.equal(messages.length, 1)
    assert.match(JSON.stringify(messages), /Hello from the new assistant/)
    assert.doesNotMatch(JSON.stringify(messages), /PRIVATE_INTERNAL_GREETING/)
    assert.match(JSON.stringify(model.requests[0]), /PRIVATE_INTERNAL_GREETING/)
    await service.close(); service = new SessionService(repository, model.config)
    service.start(session.id, 'Actual next user question'); await service.waitForIdle(session.id)
    assert.equal(service.faultCount(), 0)
    assert.match(JSON.stringify(model.requests[1]), /Hello from the new assistant/)
    assert.doesNotMatch(JSON.stringify(model.requests[1]), /PRIVATE_INTERNAL_GREETING/)
    assert.equal(repository.events.messages(session.id, undefined, 100).items.length, 3)
  } finally { await service.close(); db.close(); await model.close() }
})

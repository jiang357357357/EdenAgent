import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { EdenDatabase } from '@eden/store'
import { publicHistoryCheckpoint } from '@eden/runtime-pi'
import { recordedModel } from '@eden/runtime-pi/testing'
import { ModelService } from '../src/modules/models/index.ts'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { DirectorRunRepository, CompanionTurnCoordinator, CompanionSessionExtension } from '../src/modules/director/index.ts'
import { HandoffDispatcher, HandoffRepository, HandoffCommitRepository } from '../src/modules/handoffs/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'

const modelConfig = { id: 'model', provider: 'test', baseUrl: 'https://model.invalid/v1', contextWindow: 32000, maxTokens: 1024 }

test('multi-actor handoff carries public speaker history into the new actor and later restored turns', { timeout: 10000 }, async t => {
  const first = await recordedModel([{ text: '{"beats":[{"assistantId":1},{"assistantId":2}]}' },
    { tool: 'schedule_switch', input: { secret: 'PRIVATE_TOOL_ARGUMENT' } }, { text: 'Actor one public reply' }])
  const second = await recordedModel([{ text: 'Actor two public reply' }])
  const next = await recordedModel([{ text: 'New actor greeting' }, { text: 'Continued answer' }])
  t.after(async () => { await Promise.all([first.close(), second.close(), next.close()]) })
  const db = new EdenDatabase(':memory:', 'mon')
  const repository = new SessionRepository(db, 'mon')
  const session = repository.create('Multi handoff', [{ assistantId: 1 }, { assistantId: 2 }])
  repository.saveCheckpoint(publicHistoryCheckpoint(session.id, [{ text: 'STALE_SINGLE_CONTEXT' }]), randomUUID())
  const models = new ModelService('mon')
  models.bindActors(session.id, [first, second].map((model, i) => ({ assistantId: i + 1, characterId: i + 1,
    main: { model: model.config, entityId: i + 1, label: 'Actor' } })), first.config)
  const dispatcher = new HandoffDispatcher(repository, models, async () => ({ binding: { model: next.config, entityId: 3, label: 'New' } }))
  const tools = (sessionId: string, turnId: string) => [{ name: 'schedule_switch', revision: 'test', description: 'Schedule',
    parameters: { type: 'object', properties: { secret: { type: 'string' } } }, async execute() {
      dispatcher.repository.schedule(sessionId, turnId, { assistantId: 3 }); return { privateResult: 'PRIVATE_TOOL_RESULT' }
    } }]
  const coordinator = new CompanionTurnCoordinator(repository, new DirectorRunRepository(repository))
  let sessions = new SessionService(repository, id => models.resolve(id), tools, undefined, new CompanionSessionExtension(coordinator, models, tools), dispatcher)
  try {
    sessions.start(session.id, 'Public user question')
    await sessions.waitForIdle(session.id)
    assert.equal(sessions.faultCount(), 0)
    assert.equal(next.requests.length, 1)
    const request = JSON.stringify(next.requests[0])
    assert.match(request, /Public user question/)
    assert.match(request, /Actor one public reply/)
    assert.match(request, /Actor two public reply/)
    assert.match(request, /assistantID.*1/)
    assert.match(request, /assistantID.*2/)
    assert.doesNotMatch(request, /STALE_SINGLE_CONTEXT|PRIVATE_TOOL_ARGUMENT|PRIVATE_TOOL_RESULT/)
    assert.match(JSON.stringify(repository.checkpoint(session.id)), /STALE_SINGLE_CONTEXT/)
    await sessions.close()
    sessions = new SessionService(repository, id => models.resolve(id))
    sessions.start(session.id, 'Continue after restore')
    await sessions.waitForIdle(session.id)
    assert.equal(sessions.faultCount(), 0)
    assert.match(JSON.stringify(next.requests[1]), /Actor two public reply/)
    assert.match(JSON.stringify(next.requests[1]), /New actor greeting/)
    assert.doesNotMatch(JSON.stringify(next.requests[1]), /STALE_SINGLE_CONTEXT|PRIVATE_TOOL_ARGUMENT|PRIVATE_TOOL_RESULT|你刚接手此会话/)
  } finally { await sessions.close(); await coordinator.close(); db.close() }
})

test('failed multi-actor handoff commit restores the previous checkpoint and participants', () => {
  const db = new EdenDatabase(':memory:', 'mon')
  const repository = new SessionRepository(db, 'mon')
  const participants = [{ assistantId: 1 }, { assistantId: 2 }]
  const session = repository.create('Rollback history', participants)
  const checkpoint = publicHistoryCheckpoint(session.id, [{ text: 'Original branch' }])
  repository.saveCheckpoint(checkpoint, randomUUID())
  const inputs = new InputRepository(db, repository.events)
  const handoffs = new HandoffRepository(repository)
  try {
    inputs.enqueue(session.id, 'Switch', 'source'); const source = inputs.claim(session.id)!
    const job = handoffs.schedule(session.id, source.turnId, { assistantId: 3 })
    inputs.finish(source); handoffs.claim(session.id)
    db.connection.exec("CREATE TRIGGER reject_history_commit BEFORE INSERT ON events WHEN NEW.kind='session.assistant_handoff.completed' BEGIN SELECT RAISE(ABORT, 'history commit failure'); END")
    assert.throws(() => new HandoffCommitRepository(repository, handoffs).commit(job.id, modelConfig, 'Internal instruction'), /history commit failure/)
    assert.deepEqual(repository.checkpoint(session.id), checkpoint)
    assert.deepEqual(repository.read(session.id).participants, participants)
    assert.equal(handoffs.read(job.id).state, 'claimed')
  } finally { db.close() }
})

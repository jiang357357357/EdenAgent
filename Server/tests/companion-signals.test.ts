import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { ModelService } from '../src/modules/models/index.ts'
import { CompanionTurnCoordinator, CompanionSessionExtension, DirectorRunRepository } from '../src/modules/director/index.ts'

for (const kind of ['steer', 'follow_up'] as const) {
  test(`multi-actor ${kind} is consumed by the active actor and observed by the next actor`, async () => {
    const first = await recordedModel([{ text: '{"beats":[{"assistantId":1},{"assistantId":2}]}' },
      { tool: 'wait', input: {} }, { text: 'First answer' }, { text: 'Follow-up answer' }])
    const second = await recordedModel([{ text: 'Second actor' }])
    const db = new EdenDatabase(':memory:', 'mon')
    const repository = new SessionRepository(db, 'mon')
    const models = new ModelService('mon')
    const runs = new DirectorRunRepository(repository)
    const coordinator = new CompanionTurnCoordinator(repository, runs)
    let release!: () => void
    let entered!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const tools = () => [{ name: 'wait', description: 'Wait', revision: '1', parameters: { type: 'object' },
      async execute() { entered(); await blocked; return null } }]
    const extension = new CompanionSessionExtension(coordinator, models, tools)
    const sessions = new SessionService(repository, id => models.resolve(id), tools, undefined, extension)
    const session = repository.create('Signals to actors', [{ assistantId: 1 }, { assistantId: 2 }])
    models.bindActors(session.id, [first, second].map((model, index) => ({ assistantId: index + 1, characterId: index + 1,
      main: { model: model.config, entityId: index + 1, label: `Actor ${index + 1}` } })), first.config)
    try {
      const original = sessions.start(session.id, 'Original request')
      await started
      db.connection.exec("CREATE TRIGGER reject_signal BEFORE INSERT ON input_signals BEGIN SELECT RAISE(ABORT, 'signal disk failure'); END")
      await assert.rejects(sessions.inject(session.id, 'Never injected', kind), /signal disk failure/)
      assert.equal(db.connection.prepare('SELECT COUNT(*) AS count FROM input_signals').get()?.count, 0)
      db.connection.exec('DROP TRIGGER reject_signal')
      const accepted = await sessions.inject(session.id, 'New user instruction', kind)
      assert.equal(accepted.turnId, original.turnId)
      assert.equal(db.connection.prepare('SELECT state FROM input_signals WHERE id=?').get(accepted.inputId)?.state, 'injected')
      assert.equal(db.connection.prepare('SELECT COUNT(*) AS count FROM inputs').get()?.count, 1)
      release()
      await sessions.waitForIdle(session.id)
      assert.equal(sessions.faultCount(), 0)
      assert.equal(db.connection.prepare('SELECT state FROM input_signals WHERE id=?').get(accepted.inputId)?.state, 'consumed')
      assert.equal(first.requests.length, kind === 'steer' ? 3 : 4)
      assert.match(JSON.stringify(first.requests.at(-1)), /New user instruction/)
      assert.doesNotMatch(JSON.stringify(first.requests), /Never injected/)
      assert.match(JSON.stringify(second.requests[0]), /New user instruction/)
      const messages = repository.events.messages(session.id, undefined, 100).items
      const users = messages.filter(event => JSON.stringify(event.payload).includes('"role":"user"'))
      assert.equal(users.length, 2)
      assert.match(JSON.stringify(users[1]), /New user instruction/)
      assert.equal(runs.list(session.id)[0]?.status, 'completed')
    } finally { release(); await sessions.close(); await coordinator.close(); db.close(); await Promise.all([first.close(), second.close()]) }
  })
}

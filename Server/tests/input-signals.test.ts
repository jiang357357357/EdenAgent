import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { SignalRepository } from '../src/modules/sessions/input/signal-repository.ts'

for (const kind of ['steer', 'follow_up'] as const) {
  test(`${kind} persists before injection and records consumption during the active turn`, async () => {
    const database = new EdenDatabase(':memory:', 'local')
    const repository = new SessionRepository(database, 'local')
    const model = await recordedModel([{ tool: 'wait', input: {} }, { text: 'Tool done' }, { text: 'Follow-up done' }])
    let release!: () => void
    let entered!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const sessions = new SessionService(repository, model.config, () => [{ name: 'wait', description: 'Wait', revision: '1', parameters: { type: 'object' },
      async execute() { entered(); await blocked; return null } }])
    try {
      const session = repository.create('Signals')
      sessions.start(session.id, 'First input')
      await started
      const accepted = await sessions.inject(session.id, 'Injected request', kind)
      assert.equal(database.connection.prepare('SELECT state FROM input_signals WHERE id=?').get(accepted.inputId)?.state, 'injected')
      release()
      await sessions.waitForIdle(session.id)
      assert.equal(database.connection.prepare('SELECT state FROM input_signals WHERE id=?').get(accepted.inputId)?.state, 'consumed')
      assert.match(JSON.stringify(model.requests.at(-1)), /Injected request/)
      assert.equal(model.requests.length, kind === 'steer' ? 2 : 3)
      const events = repository.events.list(session.id, '0', 1000)
      const acceptedSeq = Number(events.find(event => event.kind === 'input.signal.accepted')?.seq)
      const consumedSeq = Number(events.find(event => event.kind === 'input.signal.consumed')?.seq)
      assert.ok(acceptedSeq < consumedSeq)
    } finally { release(); await sessions.close(); await model.close(); database.close() }
  })
}

test('restart interrupts outstanding signals and holds future inputs behind an uncertain turn across repeated recovery', async () => {
  const database = new EdenDatabase(':memory:', 'local')
  const repository = new SessionRepository(database, 'local')
  const session = repository.create('Crash')
  const inputs = new InputRepository(database, repository.events)
  const signals = new SignalRepository(database, repository.events)
  inputs.enqueue(session.id, 'Running', 'one')
  const running = inputs.claim(session.id)!
  inputs.enqueue(session.id, 'Later', 'two')
  const signalId = signals.create(session.id, running.turnId, 'steer', 'Uncertain')
  signals.setState(signalId, 'injected')
  const first = new SessionService(repository, undefined)
  await first.close()
  const second = new SessionService(repository, undefined)
  try {
    assert.equal(database.connection.prepare('SELECT state FROM input_signals WHERE id=?').get(signalId)?.state, 'interrupted')
    assert.deepEqual(inputs.pendingSessions(), [])
    assert.equal(database.connection.prepare("SELECT state FROM inputs WHERE idempotency_key='two'").get()?.state, 'held')
  } finally { await second.close(); database.close() }
})

test('unstarted queued input resumes from its persisted environment snapshot', async () => {
  const database = new EdenDatabase(':memory:', 'local')
  const repository = new SessionRepository(database, 'local')
  const session = repository.create('Pending')
  const inputs = new InputRepository(database, repository.events)
  inputs.enqueue(session.id, 'Saved input', 'one', { environment: { timezone: 'UTC' }, participants: [] })
  repository.setMetadata(session.id, [], { timezone: 'Asia/Shanghai' })
  const model = await recordedModel([{ text: 'Recovered queued input' }])
  const sessions = new SessionService(repository, model.config)
  try {
    sessions.resumePending()
    await sessions.waitForIdle(session.id)
    assert.equal(model.requests.length, 1)
    assert.match(JSON.stringify(model.requests[0]), /UTC/)
    assert.doesNotMatch(JSON.stringify(model.requests[0]), /Asia\/Shanghai/)
  } finally { await sessions.close(); await model.close(); database.close() }
})

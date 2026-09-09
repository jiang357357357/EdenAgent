import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { HandoffRepository } from '../src/modules/handoffs/index.ts'

function fixture() {
  const db = new EdenDatabase(':memory:', 'mon')
  const sessions = new SessionRepository(db, 'mon')
  const session = sessions.create('Handoff', [{ assistantId: 1 }])
  const inputs = new InputRepository(db, sessions.events)
  inputs.enqueue(session.id, 'Please switch', 'source')
  const input = inputs.claim(session.id)!
  const handoffs = new HandoffRepository(sessions)
  return { db, sessions, session, inputs, input, handoffs }
}

test('handoff remains scheduled until its source completes and recovery only releases uncommitted claims', () => {
  const f = fixture()
  try {
    const target = { assistantId: 2, assistantName: 'Next' }
    const job = f.handoffs.schedule(f.session.id, f.input.turnId, target)
    assert.equal(f.handoffs.schedule(f.session.id, f.input.turnId, target).id, job.id)
    assert.throws(() => f.handoffs.schedule(f.session.id, f.input.turnId, { assistantId: 3 }), /different/)
    assert.equal(f.handoffs.claim(f.session.id), undefined)
    assert.deepEqual(f.sessions.read(f.session.id).participants, [{ assistantId: 1 }])
    f.inputs.finish(f.input)
    assert.equal(f.handoffs.claim(f.session.id)?.state, 'claimed')
    assert.equal(f.handoffs.claim(f.session.id), undefined)
    const restored = new HandoffRepository(f.sessions)
    restored.recoverClaims(); restored.recoverClaims()
    assert.equal(restored.read(job.id).state, 'scheduled')
    assert.equal(restored.claim(f.session.id)?.id, job.id)
    restored.fail(job.id, 'Target unavailable')
    restored.recoverClaims()
    assert.equal(restored.read(job.id).state, 'failed')
    assert.equal(restored.claim(f.session.id), undefined)
    assert.throws(() => restored.fail(job.id, 'Again'), /terminal/)
    assert.equal(f.sessions.events.list(f.session.id).filter(event => event.kind === 'session.assistant_handoff.requested').length, 1)
    assert.equal(f.sessions.events.list(f.session.id).filter(event => event.kind === 'session.assistant_handoff.recovered').length, 1)
  } finally { f.db.close() }
})

test('handoff request and claim event failures roll back their state changes', () => {
  const f = fixture()
  try {
    f.db.connection.exec("CREATE TRIGGER reject_handoff BEFORE INSERT ON events WHEN NEW.kind='session.assistant_handoff.requested' BEGIN SELECT RAISE(ABORT, 'request disk failure'); END")
    assert.throws(() => f.handoffs.schedule(f.session.id, f.input.turnId, { assistantId: 2 }), /request disk failure/)
    assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS count FROM assistant_handoffs').get()?.count, 0)
    f.db.connection.exec('DROP TRIGGER reject_handoff')
    const job = f.handoffs.schedule(f.session.id, f.input.turnId, { assistantId: 2 })
    f.inputs.finish(f.input)
    f.db.connection.exec("CREATE TRIGGER reject_claim BEFORE INSERT ON events WHEN NEW.kind='session.assistant_handoff.claimed' BEGIN SELECT RAISE(ABORT, 'claim disk failure'); END")
    assert.throws(() => f.handoffs.claim(f.session.id), /claim disk failure/)
    assert.equal(f.handoffs.read(job.id).state, 'scheduled')
  } finally { f.db.close() }
})

test('cancelled source turns cannot trigger a handoff', () => {
  const f = fixture()
  try {
    f.handoffs.schedule(f.session.id, f.input.turnId, { assistantId: 2 })
    f.inputs.finish(f.input, 'User cancelled')
    assert.equal(f.handoffs.claim(f.session.id), undefined)
    assert.deepEqual(f.sessions.read(f.session.id).participants, [{ assistantId: 1 }])
  } finally { f.db.close() }
})

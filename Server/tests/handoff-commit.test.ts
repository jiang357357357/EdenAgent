import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { HandoffRepository, HandoffCommitRepository } from '../src/modules/handoffs/index.ts'

const model = { id: 'new-model', provider: 'test', baseUrl: 'https://model.invalid/v1', apiKey: 'private-model-key', contextWindow: 32000, maxTokens: 1024 }
function fixture() {
  const db = new EdenDatabase(':memory:', 'mon')
  const sessions = new SessionRepository(db, 'mon')
  const session = sessions.create('Handoff commit', [{ assistantId: 1 }], { timezone: 'UTC' })
  const inputs = new InputRepository(db, sessions.events)
  inputs.enqueue(session.id, 'Switch', 'source')
  const source = inputs.claim(session.id)!
  const handoffs = new HandoffRepository(sessions)
  const job = handoffs.schedule(session.id, source.turnId, { assistantId: 2, assistantName: 'Next' })
  inputs.finish(source); handoffs.claim(session.id)
  return { db, sessions, session, inputs, source, job, handoffs, commit: new HandoffCommitRepository(sessions, handoffs) }
}

test('handoff atomically retargets queued input while preserving text, environment and public history', () => {
  const f = fixture()
  try {
    f.sessions.events.append(f.session.id, f.source.turnId, 'agent.message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'Earlier reply' }] } })
    const oldMessages = f.sessions.events.messages(f.session.id, undefined, 100)
    const queued = f.inputs.enqueue(f.session.id, 'Existing user question', 'next', { participants: [{ assistantId: 1 }],
      companion: { old: true }, environment: { timezone: 'Asia/Shanghai' } })
    f.db.connection.exec("CREATE TRIGGER reject_retarget BEFORE INSERT ON events WHEN NEW.kind='input.handoff.updated' BEGIN SELECT RAISE(ABORT, 'retarget disk failure'); END")
    assert.throws(() => f.commit.commit(f.job.id, model, 'Hidden greeting'), /retarget disk failure/)
    const unchanged = JSON.parse(String(f.db.connection.prepare('SELECT metadata_json FROM inputs WHERE id=?').get(queued.inputId)?.metadata_json))
    assert.deepEqual(unchanged.companion, { old: true })
    assert.deepEqual(f.sessions.read(f.session.id).participants, [{ assistantId: 1 }])
    f.db.connection.exec('DROP TRIGGER reject_retarget')
    const result = f.commit.commit(f.job.id, model, 'Hidden greeting')
    assert.equal(result.inputId, queued.inputId)
    assert.equal(f.handoffs.read(f.job.id).state, 'completed')
    assert.deepEqual(f.sessions.read(f.session.id).participants, [{ assistantId: 2, assistantName: 'Next' }])
    const input = f.inputs.claim(f.session.id)!
    assert.equal(input.text, 'Existing user question')
    const metadata = input.metadata as Record<string, unknown>
    assert.deepEqual(metadata.environment, { timezone: 'Asia/Shanghai' })
    assert.equal(metadata.companion, undefined)
    assert.equal((metadata.model as { id: string }).id, 'new-model')
    assert.equal(f.db.connection.prepare('SELECT COUNT(*) AS count FROM inputs').get()?.count, 2)
    assert.deepEqual(f.sessions.events.messages(f.session.id, undefined, 100), oldMessages)
    assert.doesNotMatch(JSON.stringify(f.sessions.events.list(f.session.id)), /private-model-key/)
    f.handoffs.recoverClaims()
    assert.equal(f.handoffs.read(f.job.id).state, 'completed')
    assert.throws(() => f.commit.commit(f.job.id, model, 'Duplicate'), /not claimed/)
  } finally { f.db.close() }
})

test('handoff completion event failure rolls back participant, input and terminal changes', () => {
  const f = fixture()
  try {
    const before = f.sessions.events.list(f.session.id)
    f.db.connection.exec("CREATE TRIGGER reject_handoff_commit BEFORE INSERT ON events WHEN NEW.kind='session.assistant_handoff.completed' BEGIN SELECT RAISE(ABORT, 'commit disk failure'); END")
    assert.throws(() => f.commit.commit(f.job.id, model, 'Internal instruction'), /commit disk failure/)
    assert.deepEqual(f.sessions.read(f.session.id).participants, [{ assistantId: 1 }])
    assert.equal(f.handoffs.read(f.job.id).state, 'claimed')
    assert.equal(f.db.connection.prepare("SELECT COUNT(*) AS count FROM inputs WHERE state='queued'").get()?.count, 0)
    assert.deepEqual(f.sessions.events.list(f.session.id), before)
    f.db.connection.exec('DROP TRIGGER reject_handoff_commit')
    const committed = f.commit.commit(f.job.id, model, 'Internal instruction')
    const next = f.inputs.claim(f.session.id)!
    assert.equal(next.id, committed.inputId)
    assert.equal((next.metadata as { internalHandoff: boolean }).internalHandoff, true)
    assert.equal(next.text, 'Internal instruction')
  } finally { f.db.close() }
})

test('a new running input prevents committing a previously claimed handoff', () => {
  const f = fixture()
  try {
    f.inputs.enqueue(f.session.id, 'Raced input', 'raced')
    f.inputs.claim(f.session.id)
    assert.throws(() => f.commit.commit(f.job.id, model, 'Wait'), /idle turn boundary/)
    assert.equal(f.handoffs.read(f.job.id).state, 'claimed')
    assert.deepEqual(f.sessions.read(f.session.id).participants, [{ assistantId: 1 }])
  } finally { f.db.close() }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { MemoryExtractionRepository } from '../src/modules/memories/index.ts'

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-extraction-ledger-'))
  const filename = path.join(root, 'test.sqlite')
  let db = new EdenDatabase(filename, 'local')
  context.after(async () => { db.close(); await rm(root, { recursive: true, force: true }) })
  const sessions = new SessionRepository(db, 'local')
  const inputs = new InputRepository(db, sessions.events)
  let ledger = new MemoryExtractionRepository(db)
  const participants = [{ assistantId: 1, characterId: 11 }, { assistantId: 2, characterId: 22 }]
  const session = sessions.create('Extraction source', participants)
  inputs.enqueue(session.id, 'User fact', 'source', { participants })
  const input = inputs.claim(session.id)!
  for (const assistantID of [1, 2]) sessions.events.append(session.id, input.turnId, 'agent.message_end', {
    actor: { assistantID }, message: { role: 'assistant', content: [{ type: 'text', text: `Actor ${assistantID} reply` }] },
  })
  return { sessions, inputs, input, session, get db() { return db }, get ledger() { return ledger },
    reopen() { db.close(); db = new EdenDatabase(filename, 'local'); ledger = new MemoryExtractionRepository(db) } }
}

test('extraction scheduling binds completed input and actual actor, with stable deduplicated identity', async context => {
  const f = await fixture(context)
  assert.throws(() => f.ledger.schedule(f.input.id, 1), /completed input/)
  f.inputs.finish(f.input)
  assert.throws(() => f.ledger.schedule(f.input.id), /actual actor/)
  const first = f.ledger.schedule(f.input.id, 1)!
  const second = f.ledger.schedule(f.input.id, 2)!
  assert.equal(first.scopeKey, '11')
  assert.equal(second.scopeKey, '22')
  assert.equal(first.assistantText, 'Actor 1 reply')
  assert.equal(second.assistantText, 'Actor 2 reply')
  assert.equal(f.ledger.schedule(f.input.id, 1)?.id, first.id)
  assert.notEqual(first.id, second.id)
  assert.equal(f.ledger.schedule(f.input.id, 99), undefined)
})

test('reopen interrupts claimed extraction but retains saved candidates without another claim', async context => {
  const f = await fixture(context)
  f.inputs.finish(f.input)
  const first = f.ledger.schedule(f.input.id, 1)!
  const second = f.ledger.schedule(f.input.id, 2)!
  assert.equal(f.ledger.claim(first.id)?.state, 'extracting')
  assert.equal(f.ledger.claim(first.id), undefined)
  f.ledger.claim(second.id)
  const saved = f.ledger.saveCandidates(second.id, [{ kind: 'fact', content: 'Accepted candidate', confidence: 0.95 }])
  f.reopen()
  assert.equal(f.ledger.recover(), 1)
  assert.equal(f.ledger.recover(), 0)
  assert.equal(f.ledger.read(first.id).state, 'interrupted')
  assert.deepEqual(f.ledger.read(second.id), saved)
  assert.equal(f.ledger.claim(second.id), undefined)
  assert.throws(() => f.ledger.fail(second.id, 'late failure'), /not running/)
})

test('candidate persistence failure preserves extracting state and rejects unsafe candidates', async context => {
  const f = await fixture(context)
  f.inputs.finish(f.input)
  const job = f.ledger.schedule(f.input.id, 1)!
  f.ledger.claim(job.id)
  assert.throws(() => f.ledger.saveCandidates(job.id, [{ kind: 'fact', content: 'token: secret', confidence: 0.99 }]), /Invalid/)
  f.db.connection.exec("CREATE TRIGGER fail_candidates AFTER UPDATE ON memory_extractions WHEN NEW.state='candidates' BEGIN SELECT RAISE(ABORT, 'candidate disk failure'); END")
  assert.throws(() => f.ledger.saveCandidates(job.id, [{ kind: 'fact', content: 'Valid fact', confidence: 0.95 }]), /disk failure/)
  assert.equal(f.ledger.read(job.id).state, 'extracting')
  assert.deepEqual(f.ledger.read(job.id).candidates, [])
})

test('closed sessions and interrupted source turns cannot start extraction', async context => {
  const f = await fixture(context)
  f.inputs.finish(f.input, 'Cancelled source')
  assert.throws(() => f.ledger.schedule(f.input.id, 1), /completed input/)
  const other = await fixture(context)
  other.inputs.finish(other.input)
  const job = other.ledger.schedule(other.input.id, 1)!
  other.sessions.setStatus(other.session.id, 'closed')
  assert.equal(other.ledger.claim(job.id), undefined)
  assert.throws(() => other.ledger.schedule(other.input.id, 2), /active session/)
})

test('whole-input scheduling is atomic, idempotent and skips actors with no public reply', async context => {
  const f = await fixture(context)
  f.inputs.finish(f.input)
  f.db.connection.exec("CREATE TRIGGER fail_second_extraction BEFORE INSERT ON memory_extractions WHEN NEW.actor_id='2' BEGIN SELECT RAISE(ABORT, 'second actor disk failure'); END")
  assert.throws(() => f.ledger.scheduleInput(f.input.id), /disk failure/)
  assert.deepEqual(f.ledger.queued().items, [])
  f.db.connection.exec('DROP TRIGGER fail_second_extraction')
  const jobs = f.ledger.scheduleInput(f.input.id)
  assert.deepEqual(jobs.map(job => job.actorId), ['1', '2'])
  assert.deepEqual(f.ledger.scheduleInput(f.input.id).map(job => job.id), jobs.map(job => job.id))
  const silent = await fixture(context)
  silent.inputs.finish(silent.input)
  silent.db.connection.prepare("DELETE FROM events WHERE kind='agent.message_end' AND json_extract(payload_json,'$.actor.assistantID')=2").run()
  assert.deepEqual(silent.ledger.scheduleInput(silent.input.id).map(job => job.actorId), ['1'])
})

test('queue keyset pages remain stable as jobs are claimed and exclude closed sessions and saved candidates', async context => {
  const f = await fixture(context)
  f.inputs.finish(f.input)
  const jobs = f.ledger.scheduleInput(f.input.id)
  const first = f.ledger.queued('0', 1)
  assert.deepEqual(first.items.map(job => job.id), [jobs[0]!.id])
  assert.ok(first.nextCursor)
  f.ledger.claim(jobs[0]!.id)
  const next = f.ledger.queued(first.nextCursor!, 1)
  assert.deepEqual(next.items.map(job => job.id), [jobs[1]!.id])
  assert.equal(next.nextCursor, null)
  f.ledger.claim(jobs[1]!.id)
  f.ledger.saveCandidates(jobs[1]!.id, [])
  assert.deepEqual(f.ledger.queued().items, [])
  f.sessions.setStatus(f.session.id, 'closed')
  f.db.connection.prepare("UPDATE memory_extractions SET state='queued'").run()
  assert.deepEqual(f.ledger.queued().items, [])
  for (const cursor of ['-1', '1.5', '01', '9007199254740992']) assert.throws(() => f.ledger.queued(cursor), /bounds/)
  assert.throws(() => f.ledger.queued('0', 101), /bounds/)
})

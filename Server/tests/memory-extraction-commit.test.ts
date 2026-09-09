import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { MemoryRepository, MemoryExtractionRepository, MemoryExtractionCommitRepository, extractionApproval } from '../src/modules/memories/index.ts'
import type { MemoryExtractionJob, MemoryCandidate } from '../src/modules/memories/index.ts'

async function fixture(context: test.TestContext, candidates: MemoryCandidate[] = [
  { kind: 'fact', content: 'Likes tea', confidence: 0.95 }, { kind: 'preference', content: 'Likes coffee', confidence: 0.9 },
], participants: { assistantId?: number; characterId: number }[] = [{ assistantId: 1, characterId: 11 }]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-extraction-commit-'))
  const db = new EdenDatabase(path.join(root, 'test.sqlite'), 'local')
  context.after(async () => { db.close(); await rm(root, { recursive: true, force: true }) })
  const sessions = new SessionRepository(db, 'local')
  const inputs = new InputRepository(db, sessions.events)
  const ledger = new MemoryExtractionRepository(db)
  const session = sessions.create('Extraction commit', participants)
  inputs.enqueue(session.id, 'User fact', 'source', { participants })
  const input = inputs.claim(session.id)!
  sessions.events.append(session.id, input.turnId, 'agent.message_end', { message: { role: 'assistant', content: [{ type: 'text', text: 'Assistant reply' }] } })
  inputs.finish(input)
  const queued = ledger.schedule(input.id)!
  ledger.claim(queued.id)
  const job = ledger.saveCandidates(queued.id, candidates)
  const approve = (snapshot: MemoryExtractionJob = job, state = 'allowed') => {
    const id = randomUUID()
    const request = extractionApproval(snapshot)
    db.connection.prepare('INSERT INTO permission_requests VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, snapshot.sessionId, snapshot.turnId, 'extraction', request.capability, request.resource, state, JSON.stringify(request.details), Date.now())
    return id
  }
  return { db, sessions, session, ledger, job, approve, memories: new MemoryRepository(db), commit: new MemoryExtractionCommitRepository(db),
    scope: { scopeType: 'agent_character' as const, scopeKey: '11' } }
}

test('commit deduplicates within character, records provenance and never recreates forgotten completed memories', async context => {
  const f = await fixture(context)
  const existing = f.memories.create(f.scope, 'LIKES TEA')
  f.memories.create({ ...f.scope, scopeKey: '22' }, 'Likes coffee')
  const approvalId = f.approve()
  const ids = f.commit.commit(f.job.id, approvalId)
  assert.equal(ids[0], existing.id)
  assert.equal(f.memories.search(f.scope).length, 2)
  const added = f.memories.read(f.scope, ids[1]!)
  assert.deepEqual(added.metadata, { source: 'automatic_extraction', sourceInputId: f.job.inputId, sourceAssistantId: '1',
    confidence: 0.9, extractionJobId: f.job.id, approvalId })
  assert.equal(f.ledger.read(f.job.id).state, 'completed')
  f.memories.forget(f.scope, added.id, added.updatedAt)
  assert.deepEqual(f.commit.commit(f.job.id), ids)
  assert.equal(f.memories.search(f.scope).length, 1)
})

test('missing, denied, stale candidate and other character approvals cannot commit', async context => {
  const f = await fixture(context)
  for (const approval of [undefined, randomUUID(), f.approve(f.job, 'denied'),
    f.approve({ ...f.job, scopeKey: '22' }), f.approve({ ...f.job, candidates: [] }),
    f.approve({ ...f.job, turnId: randomUUID() })]) {
    assert.throws(() => f.commit.commit(f.job.id, approval), /matching approval/)
  }
  assert.deepEqual(f.memories.search(f.scope), [])
  assert.equal(f.ledger.read(f.job.id).state, 'candidates')
})

test('completion storage failure rolls back every inserted memory and permits exact retry', async context => {
  const f = await fixture(context)
  const approval = f.approve()
  f.db.connection.exec("CREATE TRIGGER fail_completion AFTER UPDATE ON memory_extractions WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT, 'completion disk failure'); END")
  assert.throws(() => f.commit.commit(f.job.id, approval), /disk failure/)
  assert.deepEqual(f.memories.search(f.scope), [])
  assert.equal(f.ledger.read(f.job.id).state, 'candidates')
  assert.deepEqual(f.ledger.read(f.job.id).savedIds, [])
  f.db.connection.exec('DROP TRIGGER fail_completion')
  assert.equal(f.commit.commit(f.job.id, approval).length, 2)
})

test('empty candidates complete without write approval; closed sources and tampered candidates are rejected', async context => {
  const empty = await fixture(context, [])
  assert.deepEqual(empty.commit.commit(empty.job.id), [])
  assert.equal(empty.ledger.read(empty.job.id).state, 'completed')
  const closed = await fixture(context)
  const approved = closed.approve()
  closed.sessions.setStatus(closed.session.id, 'closed')
  assert.throws(() => closed.commit.commit(closed.job.id, approved), /active session/)
  assert.deepEqual(closed.memories.search(closed.scope), [])
  const tampered = await fixture(context)
  tampered.db.connection.prepare('UPDATE memory_extractions SET candidates_json=? WHERE id=?')
    .run(JSON.stringify([{ kind: 'fact', content: 'token: secret', confidence: 0.99 }]), tampered.job.id)
  assert.throws(() => tampered.commit.commit(tampered.job.id), /canonical/)
  assert.deepEqual(tampered.memories.search(tampered.scope), [])
})

test('a single character without a remote assistant ID keeps its accepted identity through commit', async context => {
  const f = await fixture(context, [{ kind: 'fact', content: 'Local character fact', confidence: 0.95 }], [{ characterId: 11 }])
  assert.equal(f.job.actorId, '')
  const ids = f.commit.commit(f.job.id, f.approve())
  assert.equal(f.memories.read(f.scope, ids[0]!).content, 'Local character fact')
})

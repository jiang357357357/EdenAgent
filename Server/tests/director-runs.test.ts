import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { DirectorRunRepository, parseDirectorPlan } from '../src/modules/director/index.ts'
import { directorRoutes } from '../src/transport/rpc/director.routes.ts'

const plan = () => parseDirectorPlan('{"beats":[{"assistantId":1},{"assistantId":2}]}', [{ assistantId: 1 }, { assistantId: 2 }], 'test')

test('director progress is ordered and state and events commit atomically', async () => {
  const db = new EdenDatabase(':memory:', 'local')
  const sessions = new SessionRepository(db, 'local')
  const runs = new DirectorRunRepository(sessions)
  try {
    const session = sessions.create('Director')
    const run = runs.create(session.id, randomUUID(), plan(), 2)
    assert.throws(() => runs.startBeat(run.planID, 1), /out of order/)
    runs.startBeat(run.planID, 0)
    assert.throws(() => runs.startBeat(run.planID, 0), /out of order/)
    db.connection.exec("CREATE TRIGGER reject_progress BEFORE INSERT ON events WHEN NEW.kind='director.beat.completed' BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
    assert.throws(() => runs.completeBeat(run.planID, 0), /disk failure/)
    assert.equal(runs.list(session.id)[0]?.activeBeatIndex, 0)
    assert.deepEqual(runs.list(session.id)[0]?.completedBeatIndexes, [])
    db.connection.exec('DROP TRIGGER reject_progress')
    runs.completeBeat(run.planID, 0)
    runs.startBeat(run.planID, 1)
    const complete = runs.completeBeat(run.planID, 1)
    assert.equal(complete.status, 'completed')
    assert.equal(complete.activeBeatIndex, undefined)
    assert.deepEqual(complete.completedBeatIndexes, [0, 1])
    assert.throws(() => runs.fail(run.planID, 'late failure'), /terminal/)
    const list = directorRoutes(runs)['director.list']!
    assert.deepEqual(await list({ sessionId: session.id }), [complete])
    assert.deepEqual(await list({ sessionId: sessions.create('Other').id }), [])
    await assert.rejects(async () => list({ sessionId: randomUUID() }), /not found/)
  } finally { db.close() }
})

test('reopening the database preserves completed beats and fails unfinished runs without replay', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-director-'))
  const file = path.join(root, 'runtime.db')
  let db = new EdenDatabase(file, 'mon')
  try {
    let sessions = new SessionRepository(db, 'mon')
    let runs = new DirectorRunRepository(sessions)
    const session = sessions.create('Interrupted')
    const run = runs.create(session.id, randomUUID(), plan(), 2)
    runs.startBeat(run.planID, 0); runs.completeBeat(run.planID, 0); runs.startBeat(run.planID, 1)
    db.close(); db = new EdenDatabase(file, 'mon')
    sessions = new SessionRepository(db, 'mon'); runs = new DirectorRunRepository(sessions)
    runs.recoverInterrupted()
    const recovered = runs.list(session.id)[0]!
    assert.equal(recovered.status, 'failed')
    assert.deepEqual(recovered.completedBeatIndexes, [0])
    assert.match(recovered.error!, /restarted/)
    const count = sessions.events.list(session.id).length
    runs.recoverInterrupted()
    assert.equal(sessions.events.list(session.id).length, count)
    assert.throws(() => runs.startBeat(run.planID, 1), /out of order/)
  } finally { db.close(); await rm(root, { recursive: true, force: true }) }
})

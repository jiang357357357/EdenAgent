import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { EdenDatabase } from '@eden/store'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { DirectorRunRepository, parseDirectorPlan } from '../src/modules/director/index.ts'
import { wireEvent } from '../src/transport/rpc/session.routes.ts'

test('existing frontend projection and reducer consume durable director progress and replay completion', () => {
  const db = new EdenDatabase(':memory:', 'local')
  const sessions = new SessionRepository(db, 'local')
  const runs = new DirectorRunRepository(sessions)
  try {
    const session = sessions.create('Frontend director')
    const userId = randomUUID()
    const participants = [{ assistantId: 1, assistantName: 'First', profile: { api_key: 'private-profile' } }, { assistantId: 2, assistantName: 'Second' }]
    const plan = parseDirectorPlan('{"beats":[{"assistantId":1},{"assistantId":2}]}', participants, 'test')
    runs.create(session.id, randomUUID(), plan, 2, userId, participants)
    runs.startBeat(plan.planID, 0); runs.completeBeat(plan.planID, 0)
    runs.startBeat(plan.planID, 1); runs.completeBeat(plan.planID, 1)
    const events = sessions.events.list(session.id, '0', 1000).filter(event => event.kind.startsWith('companion.'))
    assert.deepEqual(events.map(event => event.kind), ['companion.director.started', 'companion.plan',
      'companion.speaker.started', 'companion.speaker.finished', 'companion.speaker.started', 'companion.speaker.finished', 'companion.director.completed'])
    assert.doesNotMatch(JSON.stringify(events), /private-profile|api_key/)
    assert.doesNotMatch(String(db.connection.prepare('SELECT participants_json FROM director_runs').get()?.participants_json), /private-profile|api_key/)
    const script = fileURLToPath(new URL('../../Script/Project/verify_director_frontend.mjs', import.meta.url))
    const result = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', script], {
      input: JSON.stringify({ sessionId: session.id, events: events.map(wireEvent) }), encoding: 'utf8', timeout: 15000,
    }))
    assert.equal(result.status, 'completed')
    assert.equal(result.userMessageID, userId)
    assert.deepEqual(result.completedBeatIndexes, [0, 1])
  } finally { db.close() }
})

test('compatibility event persistence failure rolls back internal beat state and events together', () => {
  const db = new EdenDatabase(':memory:', 'local')
  const sessions = new SessionRepository(db, 'local')
  const runs = new DirectorRunRepository(sessions)
  try {
    const session = sessions.create('Atomic compatibility')
    const plan = parseDirectorPlan('{}', [{ assistantId: 1 }], 'test')
    runs.create(session.id, randomUUID(), plan, 1)
    const before = sessions.events.list(session.id)
    db.connection.exec("CREATE TRIGGER reject_compat BEFORE INSERT ON events WHEN NEW.kind='companion.speaker.started' BEGIN SELECT RAISE(ABORT, 'compat disk failure'); END")
    assert.throws(() => runs.startBeat(plan.planID, 0), /compat disk failure/)
    assert.equal(runs.list(session.id)[0]?.status, 'planned')
    assert.deepEqual(sessions.events.list(session.id), before)
  } finally { db.close() }
})

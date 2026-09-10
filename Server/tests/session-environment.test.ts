import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository, SessionService } from '../src/modules/sessions/index.ts'
import { sessionRoutes } from '../src/transport/rpc/session.routes.ts'

const environment = { timezone: 'Asia/Shanghai', locale: 'zh-CN', location: { country: '中国', city: '上海', latitude: 31.234567, longitude: 121.456789 } }

test('environment updates commit with queued input, survive reopen, and reach the model without coordinates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-environment-'))
  const file = path.join(root, 'environment.sqlite')
  const model = await recordedModel([{ text: 'First' }, { text: 'Restored' }])
  let db = new EdenDatabase(file, 'local')
  let repository = new SessionRepository(db, 'local')
  let sessions = new SessionService(repository, model.config)
  try {
    const session = repository.create('Environment', [], { timezone: 'UTC' })
    const routes = sessionRoutes(sessions)
    db.connection.exec("CREATE TRIGGER reject_environment BEFORE INSERT ON events WHEN NEW.kind='session.environment_updated' BEGIN SELECT RAISE(ABORT, 'environment disk failure'); END")
    await assert.rejects(async () => routes['turn.start']!({ sessionId: session.id, text: 'Hello', environment, idempotencyKey: 'env' }), /environment disk failure/)
    assert.deepEqual(repository.read(session.id).environment, { timezone: 'UTC' })
    assert.equal(db.connection.prepare('SELECT COUNT(*) AS count FROM inputs').get()?.count, 0)
    assert.equal(model.requests.length, 0)
    db.connection.exec('DROP TRIGGER reject_environment')
    await routes['turn.start']!({ sessionId: session.id, text: 'Hello', environment, idempotencyKey: 'env' })
    await sessions.waitForIdle(session.id)
    await routes['turn.start']!({ sessionId: session.id, text: 'Hello', environment, idempotencyKey: 'env' })
    await sessions.waitForIdle(session.id)
    assert.equal(repository.events.list(session.id).filter(event => event.kind === 'session.environment_updated').length, 1)
    assert.equal(model.requests.length, 1)
    assert.match(JSON.stringify(model.requests[0]), /Asia\/Shanghai|上海/)
    assert.doesNotMatch(JSON.stringify(model.requests[0]), /latitude|longitude|31\.234567|121\.456789/)
    await sessions.close(); db.close()
    db = new EdenDatabase(file, 'local'); repository = new SessionRepository(db, 'local'); sessions = new SessionService(repository, model.config)
    assert.equal((repository.read(session.id).environment as { location: { latitude: number } }).location.latitude, environment.location.latitude)
    sessions.start(session.id, 'Use saved environment')
    await sessions.waitForIdle(session.id)
    assert.equal(sessions.faultCount(), 0)
    assert.match(JSON.stringify(model.requests[1]), /Asia\/Shanghai/)
    assert.doesNotMatch(JSON.stringify(model.requests[1]), /latitude|longitude|31\.234567|121\.456789/)
  } finally { await sessions.close(); db.close(); await model.close(); await rm(root, { recursive: true, force: true }) }
})

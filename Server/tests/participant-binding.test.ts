import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { EdenDatabase } from '@eden/store'
import { createServices } from '../src/bootstrap/services.ts'
import { loadConfig } from '../src/bootstrap/config.ts'
import { sessionRoutes } from '../src/transport/rpc/session.routes.ts'

test('participant changes share the configuration lock and invalidate Mon bindings only after commit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-participants-'))
  const database = new EdenDatabase(':memory:', 'mon')
  const services = createServices(database, loadConfig({ EDEN_AGENT_RUNTIME_ORIGIN: 'mon', EDEN_AGENT_V2_DATA_ROOT: root }))
  const { repository, models, sessions } = services
  const session = repository.create('Change actors', [{ assistantId: 1 }])
  const model = { id: 'old-actor-model', provider: 'test', baseUrl: 'https://model.invalid/v1', contextWindow: 32000, maxTokens: 1024 }
  models.bind(session.id, { model, entityId: 1, label: 'Old actor' })
  models.bindVision(session.id, model)
  const change = sessionRoutes(sessions)['session.set_participants']!
  let unlock!: () => void
  const lock = sessions.configureWhileIdle(session.id, () => new Promise<void>(resolve => { unlock = resolve }))
  try {
    await assert.rejects(Promise.resolve(change({ sessionId: session.id, participants: [{ assistantId: 2 }] })), /idle/)
    assert.deepEqual(repository.read(session.id).participants, [{ assistantId: 1 }])
    assert.equal(models.resolve(session.id)?.id, model.id)
    unlock(); await lock
    database.connection.exec("CREATE TRIGGER reject_participants BEFORE INSERT ON events WHEN NEW.kind='session.metadata.updated' BEGIN SELECT RAISE(ABORT, 'metadata failure'); END")
    await assert.rejects(Promise.resolve(change({ sessionId: session.id, participants: [{ assistantId: 2 }] })), /metadata failure/)
    assert.deepEqual(repository.read(session.id).participants, [{ assistantId: 1 }])
    assert.equal(models.resolve(session.id)?.id, model.id)
    assert.equal(models.resolveVision(session.id)?.id, model.id)
    database.connection.exec('DROP TRIGGER reject_participants')
    await change({ sessionId: session.id, participants: [{ assistantId: 2 }] })
    assert.deepEqual(repository.read(session.id).participants, [{ assistantId: 2 }])
    assert.equal(models.resolve(session.id), undefined)
    assert.equal(models.resolveVision(session.id), undefined)
    assert.throws(() => sessions.start(session.id, 'Do not use the previous actor model'), /No model configured/)
    await change({ sessionId: session.id, participants: [{ assistantId: 2 }, { assistantId: 3 }] })
    models.bindActors(session.id, [2, 3].map(assistantId => ({ assistantId, characterId: assistantId,
      main: { model, entityId: assistantId, label: `Actor ${assistantId}` } })))
    await change({ sessionId: session.id, participants: [{ assistantId: 4 }] })
    assert.equal(models.resolveActor(session.id, 2), undefined)
    assert.equal(models.resolveActor(session.id, 3), undefined)
  } finally {
    unlock(); await lock
    await Promise.all([services.mon.close(), services.plugins.close(), sessions.close()])
    database.close(); await rm(root, { recursive: true, force: true })
  }
})

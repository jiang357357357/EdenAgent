import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import os from 'node:os'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { createServices } from '../src/bootstrap/services.ts'
import { loadConfig } from '../src/bootstrap/config.ts'
import { sessionRoutes } from '../src/transport/rpc/session.routes.ts'
import { InputRepository } from '../src/modules/sessions/input/input-repository.ts'
import { CompanionSessionExtension } from '../src/modules/director/index.ts'

async function fixture(wait = false) {
  const first = await recordedModel([{ text: '{"beats":[{"assistantId":1},{"assistantId":2}]}' }, wait ? { wait: true } : { text: 'First reply' }])
  const second = await recordedModel([{ text: 'Second reply' }])
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-companion-session-'))
  const db = new EdenDatabase(':memory:', 'mon')
  const services = createServices(db, loadConfig({ EDEN_AGENT_RUNTIME_ORIGIN: 'mon', EDEN_AGENT_V2_DATA_ROOT: root }))
  const session = services.repository.create('Production multi-actor', [{ assistantId: 1 }, { assistantId: 2 }])
  const bindings = [{ assistantId: 1, characterId: 1, main: { model: first.config, entityId: 1, label: 'First' } },
    { assistantId: 2, characterId: 2, main: { model: second.config, entityId: 2, label: 'Second' } }]
  services.models.bindActors(session.id, bindings, first.config)
  return { first, second, db, services, session, bindings, routes: sessionRoutes(services.sessions),
    async close() {
      await Promise.all([services.sessions.close(), services.companion.close(), services.mon.close(), services.plugins.close()])
      db.close(); await Promise.all([first.close(), second.close()]); await rm(root, { recursive: true, force: true })
    } }
}

test('production session routes durably enqueue a multi-actor turn and deduplicate repeated submission', async () => {
  const setup = await fixture()
  try {
    const params = { sessionId: setup.session.id, text: 'Collaborate', idempotencyKey: 'once' }
    const one = await setup.routes['turn.start']!(params)
    const two = await setup.routes['turn.start']!(params)
    assert.equal((two as { inputId: string }).inputId, (one as { inputId: string }).inputId)
    assert.equal((two as { turnId: string }).turnId, (one as { turnId: string }).turnId)
    assert.equal(setup.db.connection.prepare('SELECT COUNT(*) AS count FROM inputs').get()?.count, 1)
    await setup.services.sessions.waitForIdle(setup.session.id)
    assert.equal(setup.services.sessions.faultCount(), 0)
    assert.equal(setup.first.requests.length, 2)
    assert.equal(setup.second.requests.length, 1)
    assert.equal(setup.services.directors.list(setup.session.id)[0]?.status, 'completed')
    assert.equal(setup.db.connection.prepare('SELECT state FROM inputs').get()?.state, 'completed')
    assert.equal(setup.services.repository.events.messages(setup.session.id, undefined, 100).items.length, 3)
  } finally { await setup.close() }
})

test('production cancellation interrupts the actor queue without marking cancellation as storage failure', async () => {
  const setup = await fixture(true)
  try {
    await setup.routes['turn.start']!({ sessionId: setup.session.id, text: 'Wait' })
    const deadline = Date.now() + 5000
    while (setup.first.requests.length < 2 && Date.now() < deadline) await delay(10)
    assert.equal(setup.first.requests.length, 2)
    await setup.routes['turn.cancel']!({ sessionId: setup.session.id })
    await setup.services.sessions.waitForIdle(setup.session.id)
    assert.equal(setup.services.sessions.faultCount(), 0)
    assert.equal(setup.second.requests.length, 0)
    assert.equal(setup.db.connection.prepare('SELECT state FROM inputs').get()?.state, 'interrupted')
    assert.equal(setup.services.directors.list(setup.session.id)[0]?.status, 'failed')
  } finally { await setup.close() }
})

test('queued multi-actor input rejects a changed model before any director or actor network request', async () => {
  const setup = await fixture()
  try {
    const extension = new CompanionSessionExtension(setup.services.companion, setup.services.models, () => [])
    const companion = extension.snapshot(setup.session.id, setup.session.participants)!
    new InputRepository(setup.db, setup.services.repository.events).enqueue(setup.session.id, 'Saved', 'saved', {
      participants: setup.session.participants, companion,
    })
    setup.services.models.bindActors(setup.session.id, setup.bindings.map(binding => ({ ...binding,
      main: { ...binding.main, model: { ...binding.main.model, id: 'changed' } } })), setup.first.config)
    setup.services.sessions.resumePending()
    await setup.services.sessions.waitForIdle(setup.session.id)
    assert.equal(setup.first.requests.length + setup.second.requests.length, 0)
    assert.equal(setup.db.connection.prepare('SELECT state FROM inputs').get()?.state, 'interrupted')
    assert.equal(setup.services.sessions.faultCount(), 1)
  } finally { await setup.close() }
})


test('an independently bound director plans the production turn without using the first actor model', async () => {
  const setup = await fixture()
  const director = await recordedModel([{ text: '{"beats":[{"assistantId":2}]}' }])
  try {
    setup.services.models.bindActors(setup.session.id, setup.bindings, director.config)
    setup.services.sessions.start(setup.session.id, 'Use the independent director')
    await setup.services.sessions.waitForIdle(setup.session.id)
    assert.equal(setup.services.sessions.faultCount(), 0)
    assert.equal(director.requests.length, 1)
    assert.equal(setup.first.requests.length, 0)
    assert.equal(setup.second.requests.length, 1)
    assert.equal(setup.services.directors.list(setup.session.id)[0]?.status, 'completed')
  } finally { await setup.close(); await director.close() }
})

test('queued turns reject director-only configuration changes before making any request', async () => {
  const setup = await fixture()
  try {
    const extension = new CompanionSessionExtension(setup.services.companion, setup.services.models, () => [])
    const companion = extension.snapshot(setup.session.id, setup.session.participants)!
    new InputRepository(setup.db, setup.services.repository.events).enqueue(setup.session.id, 'Saved', 'director-change', {
      participants: setup.session.participants, companion,
    })
    setup.services.models.bindActors(setup.session.id, setup.bindings, { ...setup.first.config, id: 'new-director' })
    setup.services.sessions.resumePending()
    await setup.services.sessions.waitForIdle(setup.session.id)
    assert.equal(setup.first.requests.length + setup.second.requests.length, 0)
    assert.equal(setup.db.connection.prepare('SELECT state FROM inputs').get()?.state, 'interrupted')
    assert.equal(setup.services.sessions.faultCount(), 1)
  } finally { await setup.close() }
})

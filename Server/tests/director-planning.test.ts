import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { EdenDatabase } from '@eden/store'
import { recordedModel } from '@eden/runtime-pi/testing'
import { SessionRepository } from '../src/modules/sessions/index.ts'
import { DirectorPlanningService, DirectorRunRepository } from '../src/modules/director/index.ts'

async function fixture(reply: { text: string } | { wait: true } | { tool: string; input: Record<string, unknown> }) {
  const model = await recordedModel([reply])
  const db = new EdenDatabase(':memory:', 'local')
  const sessions = new SessionRepository(db, 'local')
  const runs = new DirectorRunRepository(sessions)
  const planner = new DirectorPlanningService(sessions, runs)
  const session = sessions.create('Director model')
  const controller = new AbortController()
  return { model, db, sessions, runs, planner, controller,
    request: { sessionId: session.id, turnId: randomUUID(), userText: '请协作完成', participants: [{ assistantId: 1 }, { assistantId: 2 }],
      conversation: '已有公开对话', attachments: '', model: model.config, signal: controller.signal },
    async close() { controller.abort(); await model.close(); db.close() } }
}

test('director makes a recorded model request and persists its plan without public assistant messages', async () => {
  const setup = await fixture({ text: '{"beats":[{"assistantId":2},{"assistantId":1}]}' })
  try {
    const run = await setup.planner.plan(setup.request)
    assert.deepEqual(run.beats.map(beat => beat.assistantID), [2, 1])
    assert.equal(run.source, 'model')
    assert.equal(run.status, 'planned')
    assert.equal(setup.model.requests.length, 1)
    const events = setup.sessions.events.list(setup.request.sessionId)
    const request = events.find(event => event.kind === 'director.model.request')!
    assert.deepEqual((request.payload as Record<string, unknown>).payload, setup.model.requests[0])
    assert.ok(events.some(event => event.kind === 'director.planned'))
    assert.ok(!events.some(event => event.kind === 'agent.message_end'))
    assert.equal(setup.runs.list(setup.request.sessionId).length, 1)
  } finally { await setup.close() }
})

test('director request persistence failure prevents HTTP and plan creation', async () => {
  const setup = await fixture({ text: '{"beats":[{"assistantId":1}]}' })
  try {
    setup.db.connection.exec("CREATE TRIGGER reject_request BEFORE INSERT ON events WHEN NEW.kind='director.model.request' BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
    await assert.rejects(setup.planner.plan(setup.request), /persistence failed/)
    assert.equal(setup.model.requests.length, 0)
    assert.deepEqual(setup.runs.list(setup.request.sessionId), [])
  } finally { await setup.close() }
})

test('cancelling a pending director response creates no plan and does not retry', async () => {
  const setup = await fixture({ wait: true })
  const task = setup.planner.plan(setup.request)
  const rejected = assert.rejects(task)
  try {
    const deadline = Date.now() + 5000
    while (!setup.model.requests.length && Date.now() < deadline) await delay(10)
    assert.equal(setup.model.requests.length, 1)
    setup.controller.abort()
    await rejected
    assert.deepEqual(setup.runs.list(setup.request.sessionId), [])
    assert.equal(setup.model.requests.length, 1)
  } finally { setup.controller.abort(); await rejected; await setup.close() }
})

test('director tool calls produce a deterministic fallback without executing the requested tool', async () => {
  const setup = await fixture({ tool: 'eden_exec', input: { command: 'should never run' } })
  try {
    const run = await setup.planner.plan(setup.request)
    assert.equal(run.source, 'fallback')
    assert.equal(run.diagnostic, 'director_request_failed')
    assert.deepEqual(run.beats.map(beat => beat.assistantID), [1])
    assert.equal(setup.model.requests.length, 1)
    assert.equal(setup.runs.list(setup.request.sessionId).length, 1)
  } finally { await setup.close() }
})


test('director HTTP failure falls back to the mentioned actor without retries or leaking provider errors', async () => {
  const setup = await fixture({ text: 'unused' })
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(503, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'private-provider-error', type: 'server_error' } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const run = await setup.planner.plan({ ...setup.request, userText: '请乙回答',
      participants: [{ assistantId: 1, assistantName: '甲' }, { assistantId: 2, assistantName: '乙' }],
      model: { ...setup.model.config, baseUrl: `http://127.0.0.1:${address.port}/v1` } })
    assert.equal(run.source, 'fallback')
    assert.equal(run.diagnostic, 'director_request_failed')
    assert.deepEqual(run.beats.map(beat => beat.assistantID), [2])
    assert.equal(requests, 1)
    assert.doesNotMatch(JSON.stringify(setup.sessions.events.list(setup.request.sessionId)), /private-provider-error/)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await setup.close()
  }
})

test('fallback result persistence failure still prevents plan creation', async () => {
  const setup = await fixture({ text: 'invalid director output' })
  try {
    setup.db.connection.exec("CREATE TRIGGER reject_result BEFORE INSERT ON events WHEN NEW.kind='director.model.result' BEGIN SELECT RAISE(ABORT, 'result disk failure'); END")
    await assert.rejects(setup.planner.plan(setup.request), /result disk failure/)
    assert.equal(setup.model.requests.length, 1)
    assert.deepEqual(setup.runs.list(setup.request.sessionId), [])
  } finally { await setup.close() }
})

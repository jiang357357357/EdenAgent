import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { artifactClient, artifactHost } from './workspace_artifact_fixture.mjs'

const entry = fileURLToPath(new URL('../../dist/server/main.mjs', import.meta.url))

for (const kind of ['execution', 'storage']) test(`compiled RPC ${kind} fault permits safe new submission in the same host`, async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'eden-session-fault-artifact-')))
  let host, client, database, requests = 0
  const model = createServer(async (request, response) => {
    for await (const chunk of request) { void chunk }
    requests++
    if (kind === 'execution' && requests === 1) {
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'fixture bad model request' } }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: 'fixture-response',
      object: 'chat.completion.chunk', created: 1, model: 'recorded', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    chunk({ role: 'assistant' }); chunk({ content: 'Fresh request succeeded' }); chunk({}, 'stop')
    response.end('data: [DONE]\n\n')
  })
  t.after(async () => {
    client?.close()
    try { await host?.close() } finally {
      database?.close(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve))
      assert.equal(path.dirname(root), await realpath(tmpdir()))
      assert.ok(path.basename(root).startsWith('eden-session-fault-artifact-'))
      await rm(root, { recursive: true, force: true })
    }
  })
  model.listen(0, '127.0.0.1'); await once(model, 'listening')
  const data = path.join(root, 'data')
  host = await artifactHost(entry, root, data, { model: { provider: 'recorded', id: 'recorded',
    baseUrl: `http://127.0.0.1:${model.address().port}/v1` } })
  client = await artifactClient(host)
  database = new DatabaseSync(path.join(data, 'eden-agent.db'))
  const session = await client.rpc('session.create', { title: 'Fixture fault recovery' })
  if (kind === 'storage') database.exec("CREATE TRIGGER reject_request BEFORE INSERT ON events WHEN NEW.kind='model.request' BEGIN SELECT RAISE(ABORT,'fixture request disk failure'); END")
  const failed = await client.rpc('turn.start', { sessionId: session.id, text: 'First request' })
  await waitForInput(database, failed.inputId, 'interrupted')
  const events = await client.rpc('event.list', { sessionId: session.id, afterSeq: '0', limit: 1000 })
  assert.match(JSON.stringify(events), kind === 'storage' ? /fixture request disk failure/ : /fixture bad model request/)
  if (kind === 'storage') {
    assert.equal(requests, 0)
    database.exec("DROP TRIGGER reject_request; CREATE TRIGGER reject_recovery BEFORE INSERT ON events WHEN NEW.kind='session.storage.recovered' BEGIN SELECT RAISE(ABORT,'fixture database still unwritable'); END")
    await assert.rejects(client.rpc('turn.start', { sessionId: session.id, text: 'Blocked request' }), error => {
      assert.match(error.message, /会话存储尚未恢复.*fixture database still unwritable/)
      assert.doesNotMatch(error.message, /Session storage failed/)
      return true
    })
    assert.equal(requests, 0)
    database.exec('DROP TRIGGER reject_recovery')
  }
  const fresh = await client.rpc('turn.start', { sessionId: session.id, text: 'New explicit request after repair' })
  await waitForInput(database, fresh.inputId, 'completed')
  assert.equal(requests, kind === 'execution' ? 2 : 1)
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM events WHERE session_id=? AND kind='session.storage.recovered'").get(session.id).n,
    kind === 'storage' ? 1 : 0)
})

async function waitForInput(database, inputId, expected) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const state = database.prepare('SELECT state FROM inputs WHERE id=?').get(inputId)?.state
    if (state === expected) return
    assert.notEqual(state, 'held', `Unexpected held input ${inputId}`)
    await delay(25)
  }
  assert.fail(`Input did not reach ${expected}`)
}

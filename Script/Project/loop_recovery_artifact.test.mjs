import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { artifactHost, artifactClient } from './workspace_artifact_fixture.mjs'

const entry = process.env.EDEN_LOOP_ARTIFACT_ENTRY ?? fileURLToPath(new URL('../../dist/server/main.mjs', import.meta.url))
test('compiled Mon RPC stops voice/projection loops, renews its owner token and accepts the next model turn', { timeout: 60000 }, async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'eden-loop-recovery-artifact-'))), data = path.join(root, 'data')
  let host, client, db, speechCalls = 0, modelCalls = 0, exchanges = 0, speechStatus = 500, blockedSession = '', sessionPosts = 0
  let serviceToken = '', unknownResponse = false
  const model = createServer(async (request, response) => {
    for await (const chunk of request) { void chunk }; modelCalls++
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1,
      model: 'recorded', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    chunk({ role: 'assistant' }); chunk({ content: 'The next turn completed.' }); chunk({}, 'stop'); response.end('data: [DONE]\n\n')
  })
  const core = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk
    const url = request.url, token = request.headers.authorization
    const json = value => response.end(JSON.stringify(value))
    if (url === '/api/internal/service-token/') { serviceToken = `fixture-service-${++exchanges}`; json({ token: serviceToken, user_id: '7', expires_in: 1200 }); return }
    if (token !== 'Token fixture-browser' && token !== `Token ${serviceToken}`) { response.writeHead(401); json({ detail: 'expired credential' }); return }
    if (url === '/api/users/me/profile/') { json({ id: 7 }); return }
    if (url === '/api/agent/sessions/') {
      sessionPosts++
      if (JSON.parse(body).external_session_id === blockedSession) { response.writeHead(400); json({ assistant: ['not enabled for this session'] }); return }
      json({ id: 17 }); return
    }
    if (url.endsWith('/participants/')) { json({ ok: true }); return }
    if (url.endsWith('/messages/') || url.endsWith('/director-runs/')) { json({ sync_status: 'synced' }); return }
    if (url === '/api/tts/configs/synthesize/') {
      speechCalls++; response.writeHead(speechStatus)
      if (unknownResponse) json({ detail: 'gateway response lost' })
      else json(speechStatus === 200 ? { success: true, audio_url: '/media/fixture.wav', duration_ms: 100 } : { success: false, error_message: 'reference audio missing' })
      return
    }
    if (url === '/media/fixture.wav') { response.writeHead(200, { 'content-type': 'audio/wav' }).end(Buffer.from('RIFFfixtureaudio')); return }
    const entity = { id: 1, ai_model: 'recorded', ai_name: 'Fixture model', vendor: 'recorded', status: 'active',
      api_key: 'fixture-only', api_endpoint: `http://127.0.0.1:${model.address().port}/v1`, default_params: { context_window: 32000, max_tokens: 1024 } }
    json(url.startsWith('/api/assistants/') ? { id: 1, name: 'Fixture actor', character: { id: 11, name: 'Fixture character', ai_talk_entity_id: 1 } }
      : url === '/api/agent/settings/my/' ? { default_model: '1' } : url === '/api/core/vendors/ai/' ? { vendors: {} }
      : url === '/api/ai/entities/' ? [entity] : entity)
  })
  t.after(async () => {
    client?.close(); await host?.close(); db?.close()
    core.closeAllConnections(); model.closeAllConnections()
    await Promise.all([new Promise(resolve => core.close(resolve)), new Promise(resolve => model.close(resolve))])
    assert.equal(path.dirname(root), await realpath(tmpdir())); assert.ok(path.basename(root).startsWith('eden-loop-recovery-artifact-'))
    await rm(root, { recursive: true, force: true })
  })
  model.listen(0, '127.0.0.1'); core.listen(0, '127.0.0.1'); await Promise.all([once(model, 'listening'), once(core, 'listening')])
  const coreUrl = `http://127.0.0.1:${core.address().port}`, options = { origin: 'mon', coreUrl, serviceIdentity: { userId: '7', secret: 'fixture-only-service-secret' } }
  const open = async () => {
    host = await artifactHost(entry, root, data, options); client = await artifactClient(host, { origin: 'mon', coreToken: 'fixture-browser' })
    const key = JSON.stringify([new URL(coreUrl + '/').href, '7']), directory = createHash('sha256').update(key).digest('hex')
    db = new DatabaseSync(path.join(data, 'accounts', directory, 'storage', 'eden-agent.db'))
  }
  await open()
  const session = await client.rpc('session.create', { title: 'Fixture loop recovery', participants: [{ assistantId: 1 }] })
  await client.rpc('model.catalog', { sessionId: session.id, coreBaseUrl: coreUrl, coreToken: 'fixture-browser' })
  db.prepare('UPDATE mon_connections SET core_token=? WHERE session_id=?').run('expired-service-fixture', session.id)
  db.prepare('UPDATE mon_service_credentials SET enabled=1 WHERE session_id=?').run(session.id)
  const speech = { sessionId: session.id, messageId: 'voice-one', segmentGroupId: 'voice-one', groupIndex: 0, sequence: 0, text: 'Test sentence.', configId: 1, mode: 'all', intent: 'auto' }
  await assert.rejects(client.rpc('voice.tts.synthesize', speech), error => { assert.equal(error.data.status, 500); assert.equal(error.data.outcome, 'failed'); assert.match(error.message, /reference audio missing/); return true })
  for (let index = 0; index < 12; index++) await assert.rejects(client.rpc('voice.tts.synthesize', { ...speech, segmentGroupId: `rewrite:${index}` }), /自动语音已暂停/)
  assert.equal(speechCalls, 1); assert.equal(exchanges, 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mon_operations WHERE state='failed'").get().n, 1)
  client.close(); await host.close(); db.close(); await open()
  await assert.rejects(client.rpc('voice.tts.synthesize', { ...speech, segmentGroupId: 'after-restart' }), /自动语音已暂停/)
  assert.equal(speechCalls, 1)
  const turn = await client.rpc('turn.start', { sessionId: session.id, text: 'Continue after speech failure' })
  await waitFor(() => db.prepare('SELECT state FROM inputs WHERE id=?').get(turn.inputId)?.state === 'completed')
  assert.equal(modelCalls, 1)
  speechStatus = 200
  const audio = await client.rpc('voice.tts.synthesize', { ...speech, intent: 'manual' })
  assert.ok(audio.audio_blob_id); assert.equal(speechCalls, 2); assert.equal(exchanges, 2)
  speechStatus = 502; unknownResponse = true
  const unknown = { ...speech, messageId: 'voice-unknown', segmentGroupId: 'unknown' }
  await assert.rejects(client.rpc('voice.tts.synthesize', unknown), error => error.data.outcome === 'unknown' && error.data.retryable === false)
  await assert.rejects(client.rpc('voice.tts.synthesize', { ...unknown, segmentGroupId: 'unknown-rewrite' }), /自动语音已暂停/)
  assert.equal(speechCalls, 3)
  const other = await client.rpc('session.create', { title: 'Rejected projection', participants: [{ assistantId: 1 }] }); blockedSession = other.id
  await client.rpc('model.catalog', { sessionId: other.id, coreBaseUrl: coreUrl, coreToken: 'fixture-browser' })
  await assert.rejects(client.rpc('voice.tts.synthesize', { ...speech, sessionId: other.id }), /not enabled/)
  await waitFor(() => db.prepare('SELECT retry_at FROM mon_sync_progress WHERE session_id=?').get(other.id)?.retry_at === -1)
  const before = sessionPosts; await delay(2200); assert.equal(sessionPosts, before)
  const status = await client.rpc('mon.sync.status', { sessionId: other.id }); assert.ok(status.progress.some(item => item.retryAt === -1)); assert.equal(status.totals.failed, 1)
  blockedSession = ''; await client.rpc('mon.sync.resume', { sessionId: other.id, confirm: true })
  await waitFor(() => db.prepare('SELECT error FROM mon_sync_progress WHERE session_id=?').get(other.id)?.error === null)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='session.halted'").get().n, 0)
})
async function waitFor(check) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) { if (check()) return; await delay(30) }
  assert.fail('Artifact condition timed out')
}

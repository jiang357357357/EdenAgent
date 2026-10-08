import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { MonClient, MonHttpError, MonServiceCredentials, serviceSignature } from '../src/index.ts'

test('real HTTP service exchange renews proactively, coalesces requests and retries a confirmed 401 only once', async t => {
  let exchanges = 0, requests = 0, token = '', rejectAll = false, foreign = false, now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const secret = 'fixture-service-secret'
  const server = createServer(async (request, response) => {
    if (request.url === '/api/internal/service-token/') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      assert.equal(request.headers['x-mon-service-signature'], serviceSignature(secret, 'monagent', 'core:service_token',
        String(request.headers['x-mon-service-timestamp']), String(request.headers['x-mon-service-nonce']), request.url, body))
      token = `lease-${++exchanges}`
      response.end(JSON.stringify({ user_id: foreign ? '8' : '7', token, expires_in: 1200, expires_at: new Date(now + 1200000).toISOString() })); return
    }
    requests++
    if (request.url === '/api/denied/') { response.writeHead(403).end(JSON.stringify({ detail: '权限不足' })); return }
    if (rejectAll || request.headers.authorization !== `Token ${token}`) { response.writeHead(401).end(JSON.stringify({ detail: '已过期' })); return }
    response.end(JSON.stringify({ ok: true }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`, lifetime = new AbortController()
  t.after(async () => { lifetime.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const credentials = new MonServiceCredentials({ coreBaseUrl: base, secret, userId: '7' }, lifetime.signal)
  const client = new MonClient(base, 'expired-persisted', credentials)
  assert.deepEqual(await Promise.all(Array.from({ length: 12 }, () => client.get('/api/check/'))), Array(12).fill({ ok: true }))
  assert.equal(exchanges, 1)
  now += 1200000
  await Promise.all(Array.from({ length: 8 }, () => client.get('/api/check/')))
  assert.equal(exchanges, 2)
  token = 'invalidated'
  await client.post('/api/check/', { intent: 'fixture mutation' })
  assert.equal(exchanges, 3)
  const before403 = exchanges
  await assert.rejects(client.get('/api/denied/'), error => error instanceof MonHttpError && error.status === 403)
  assert.equal(exchanges, before403)
  rejectAll = true
  const before = requests
  await assert.rejects(client.post('/api/check/', {}), error => error instanceof MonHttpError && error.status === 401)
  assert.equal(requests - before, 2)
  rejectAll = false; foreign = true; now += 1200000
  const beforeForeign = requests
  await assert.rejects(client.get('/api/check/'), /user mismatch/)
  assert.equal(requests, beforeForeign)
})

test('structured HTTP failure preserves endpoint, business failure and bounded redacted details', async t => {
  const server = createServer((_request, response) => response.writeHead(500).end(JSON.stringify({ success: false,
    error_message: 'reference audio missing', errors: { reference: ['not found'] }, token: 'private-sentinel' })))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const client = new MonClient(`http://127.0.0.1:${(server.address() as { port: number }).port}`, 'fixture')
  await assert.rejects(client.post('/api/tts/configs/synthesize/', {}), error => {
    assert.ok(error instanceof MonHttpError); assert.equal(error.details.outcome, 'failed'); assert.equal(error.details.retryable, false)
    assert.equal(error.details.endpoint, '/api/tts/configs/synthesize/'); assert.match(error.message, /reference audio missing/)
    assert.doesNotMatch(error.message, /private-sentinel/); return true
  })
})

test('one cancelled consumer does not abort a shared token exchange', async t => {
  let finish!: () => void
  const server = createServer((_request, response) => { finish = () => response.end(JSON.stringify({ user_id: '7', token: 'fresh', expires_in: 1200 })) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const lifetime = new AbortController(), cancelled = new AbortController()
  t.after(async () => { lifetime.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const credentials = new MonServiceCredentials({ coreBaseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, secret: 'fixture', userId: '7' }, lifetime.signal)
  const first = credentials.token(cancelled.signal), second = credentials.token()
  const rejected = assert.rejects(first)
  while (!finish) await new Promise<void>(resolve => setImmediate(resolve))
  cancelled.abort(); await rejected; finish()
  assert.equal(await second, 'fresh')
})

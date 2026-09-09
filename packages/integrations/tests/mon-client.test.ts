import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MonClient } from '../src/index.ts'

test('Mon transport keeps credentials on its configured origin and follows the Token authentication contract', async () => {
  const requests: { url: string; method: string; authorization: string; body: string }[] = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk.toString()
    requests.push({ url: request.url!, method: request.method!, authorization: request.headers.authorization!, body })
    if (request.url?.endsWith('redirect/')) { response.writeHead(302, { location: '/api/stolen/' }).end(); return }
    if (request.url?.endsWith('denied/')) { response.writeHead(401).end('sensitive upstream detail'); return }
    if (request.url === '/prefix/api/pages/') { response.end(JSON.stringify({ results: [{ id: 1 }], next: '?page=2' })); return }
    if (request.url === '/prefix/api/pages/?page=2') { response.end(JSON.stringify({ results: [{ id: 2 }], next: null })); return }
    if (request.url === '/prefix/api/hostile-pages/') { response.end(JSON.stringify({ results: [], next: 'https://elsewhere.invalid/api/pages/' })); return }
    if (request.url === '/prefix/api/cycle/') { response.end(JSON.stringify({ results: [], next: '/prefix/api/cycle/' })); return }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const client = new MonClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}/prefix`, 'test-token')
  try {
    assert.deepEqual(await client.get('/api/assistants/current/'), { ok: true })
    await client.patch('/api/agent/settings/my/', { default_model: '7' })
    assert.equal(requests[0]?.authorization, 'Token test-token')
    assert.equal(requests[0]?.url, '/prefix/api/assistants/current/')
    assert.equal(requests[1]?.method, 'PATCH')
    assert.deepEqual(JSON.parse(requests[1]!.body), { default_model: '7' })
    await assert.rejects(client.get('/api/redirect/'))
    assert.ok(!requests.some(request => request.url.includes('stolen')))
    await assert.rejects(client.get('/api/denied/'), error => error instanceof Error && /authentication/.test(error.message) && !/sensitive/.test(error.message))
    const count = requests.length
    for (const path of ['https://elsewhere.example/api/', '//elsewhere/api/', '/api/../private/', '/api/%2e%2e/private/']) await assert.rejects(client.get(path), /path/)
    assert.equal(requests.length, count)
    assert.deepEqual(await client.getCollection('/api/pages/'), [{ id: 1 }, { id: 2 }])
    await assert.rejects(client.getCollection('/api/hostile-pages/'), /configured base/)
    await assert.rejects(client.getCollection('/api/cycle/'), /cycle/)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

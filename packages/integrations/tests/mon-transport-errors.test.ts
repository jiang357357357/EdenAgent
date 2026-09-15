import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { monFetch } from '../src/mon/transport.ts'

test('real refused connection reports cause and destination without query credentials', async () => {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  await assert.rejects(monFetch(`http://127.0.0.1:${port}/api/test/?token=private-sentinel`, {}), error => {
    assert.match(String(error), /ECONNREFUSED/); assert.match(String(error), /Core 连接失败/)
    assert.doesNotMatch(String(error), /private-sentinel|token=/); return true
  })
})

test('cancelled requests are distinguished from network failures', async () => {
  await assert.rejects(monFetch('http://127.0.0.1:1/', { signal: AbortSignal.abort() }), /请求已取消/)
})

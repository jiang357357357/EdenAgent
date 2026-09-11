import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { waitForHealth } from './runtime_children.mjs'

const child = { exitCode: null, signalCode: null }
async function fixture(context, handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return server.address().port
}

test('health polling tolerates startup failures and accepts the matching realm', async context => {
  let calls = 0
  const port = await fixture(context, (_request, response) => {
    calls++
    response.writeHead(calls < 3 ? 503 : 200).end(JSON.stringify({ runtimeOrigin: 'mon', serverVersion: '2.0.0-dev.0' }))
  })
  await waitForHealth(port, 'mon', child, { timeoutMs: 2000, intervalMs: 5 })
  assert.equal(calls, 3)
})

test('wrong-world response times out with endpoint and mismatch details', async context => {
  const port = await fixture(context, (_request, response) => response.end(JSON.stringify({ runtimeOrigin: 'local', serverVersion: 'old' })))
  await assert.rejects(waitForHealth(port, 'mon', child, { timeoutMs: 150, intervalMs: 5 }), error => {
    assert.match(error.message, /startup timed out/)
    assert.ok(error.message.includes(`127.0.0.1:${port}/healthz`))
    assert.match(error.message, /origin=local, version=old/)
    return true
  })
})

test('a stalled response respects the deadline and reports the request timeout', async context => {
  const port = await fixture(context, () => {})
  await assert.rejects(waitForHealth(port, 'mon', child, { timeoutMs: 100, intervalMs: 5 }), /startup timed out.*timeout/i)
})

test('child exit reports its exit status immediately', async () => {
  await assert.rejects(waitForHealth(1, 'mon', { exitCode: 7, signalCode: null }), /code=7/)
})

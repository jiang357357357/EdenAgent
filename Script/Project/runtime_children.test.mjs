import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { takeOverTcpPort, waitForHealth } from './runtime_children.mjs'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolveDevelopmentRealmRoot } from './runtime_children.mjs'

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

test('a later launcher takes over an occupied TCP port', async context => {
  const probe = createServer((_request, response) => response.end('old'))
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const listener = spawn(process.execPath, ['-e', `require('node:http').createServer((q,s)=>s.end('old')).listen(${port},'127.0.0.1')`], {
    stdio: 'ignore', detached: process.platform !== 'win32',
  })
  context.after(() => { try { listener.kill('SIGKILL') } catch {} })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}`); if (await response.text() === 'old') break } catch {}
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const killed = takeOverTcpPort(port, 'test listener', { log: () => {} })
  assert.deepEqual(killed, [listener.pid])
  await new Promise(resolve => listener.once('exit', resolve))
  const replacement = createServer((_request, response) => response.end('new'))
  await new Promise(resolve => replacement.listen(port, '127.0.0.1', resolve))
  context.after(() => new Promise(resolve => replacement.close(resolve)))
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'new')
})

test('development keeps using a retained v2 realm when the current path still contains the legacy database', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'eden-agent-realm-'))
  const realm = path.join(root, 'Data', 'realms', 'mon')
  const retained = path.join(realm, 'v2')
  mkdirSync(retained, { recursive: true })
  for (const [filename, current] of [[path.join(realm, 'eden-agent.db'), false], [path.join(retained, 'eden-agent.db'), true]]) {
    const database = new DatabaseSync(filename)
    database.exec(current ? 'CREATE TABLE realm_meta (key TEXT PRIMARY KEY, value TEXT)' : 'CREATE TABLE legacy_events (id TEXT)')
    database.close()
  }
  assert.equal(resolveDevelopmentRealmRoot(root, 'mon'), retained)
  assert.equal(resolveDevelopmentRealmRoot(root, 'mon', '/explicit/realm'), '/explicit/realm')
})

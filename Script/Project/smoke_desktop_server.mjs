import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createAgentServerManager } from '../../frontend/desktop/src/processes/agent-server.cjs'

const agentRoot = fileURLToPath(new URL('../../', import.meta.url))
const resourcesPath = process.argv[2] ? path.resolve(process.argv[2]) : undefined
const directory = await mkdtemp(path.join(tmpdir(), 'eden-desktop-server-'))
async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
const ports = { mon: await freePort(), local: await freePort() }
while (ports.local === ports.mon) ports.local = await freePort()
let output = ''
const manager = createAgentServerManager({
  app: { isPackaged: Boolean(resourcesPath), getPath: () => directory }, agentRoot: resourcesPath ? directory : agentRoot,
  // A test must never terminate another process if an ephemeral port is claimed in the meantime.
  takeOverPort: () => {},
  processObject: { platform: process.platform, execPath: process.execPath, resourcesPath,
    env: { PATH: process.env.PATH, ...(resourcesPath ? {} : { EDEN_AGENT_NODE_PATH: process.execPath }),
      EDEN_AGENT_MON_PORT: String(ports.mon), EDEN_AGENT_LOCAL_PORT: String(ports.local) },
    stdout: { write: chunk => { output += chunk } }, stderr: { write: chunk => { output += chunk } } },
})
async function ready(origin) {
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(manager.status(origin).running, true, output)
    try {
      const response = await fetch(`${manager.capability(origin).baseUrl}/healthz`, { signal: AbortSignal.timeout(300) })
      const health = await response.json()
      if (response.ok && health.runtimeOrigin === origin && health.serverVersion === '2.0.0-dev.0') return
    } catch { /* The child has not yet opened its listener. */ }
    await delay(100)
  }
  throw new Error(`Desktop ${origin} startup timed out: ${output}`)
}
try {
  const [mon, local] = manager.start()
  await Promise.all(['mon', 'local'].map(ready))
  assert.notEqual(mon.pid, local.pid)
  for (const origin of ['mon', 'local']) {
    const token = await readFile(path.join(directory, 'server', 'realms', origin, 'capability.token'), 'utf8')
    assert.equal(token, manager.capability(origin).token)
  }
  await manager.restart('local')
  assert.notEqual(local.exitCode, null)
  assert.equal(mon.exitCode, null)
  await ready('local')
  await manager.stop()
  assert.equal(mon.exitCode, 0)
  assert.equal(manager.status('mon').running, false)
  assert.equal(manager.status('local').running, false)
  assert.match(output, /\[INFO\] \[Agent\/伊甸园\] 服务已就绪/)
  assert.match(output, /\[INFO\] \[Agent\/尘世\] 服务已就绪/)
  assert.match(output, /\[WARN\].*SQLite/)
  assert.match(output, /服务已关闭/)
  assert.doesNotMatch(output, /\u001b\[/)
  for (const origin of ['mon', 'local']) {
    const logs = path.join(directory, 'server', 'realms', origin, 'logs')
    const names = await readdir(logs)
    assert.equal(names.length, origin === 'mon' ? 1 : 2)
    for (const name of names) {
      assert.match(name, new RegExp(`^agent-${origin}-\\d+\\.jsonl$`))
      const contents = await readFile(path.join(logs, name), 'utf8')
      const records = contents.trim().split('\n').map(line => JSON.parse(line))
      assert.ok(records.every(record => record.origin === origin))
      assert.ok(records.some(record => record.event === 'server.listening'))
      assert.ok(records.some(record => record.event === 'server.stopped'))
      for (const realm of ['mon', 'local']) {
        assert.ok(!contents.includes(manager.capability(realm).token))
        assert.ok(!output.includes(manager.capability(realm).token))
      }
    }
  }
  process.stdout.write('Desktop supervisor: two real TS servers, Chinese logs, JSONL, persisted tokens, local restart and IPC drain passed\n')
} finally {
  await manager.stop()
  assert.equal(path.dirname(directory), path.resolve(tmpdir()))
  assert.ok(path.basename(directory).startsWith('eden-desktop-server-'))
  await rm(directory, { recursive: true, force: true })
}

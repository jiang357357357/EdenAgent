import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
    const token = await readFile(path.join(directory, 'server', 'realms', origin, 'v2', 'capability.token'), 'utf8')
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
  process.stdout.write('Desktop supervisor: isolated TS servers, persisted tokens, local restart and IPC drain passed\n')
} finally {
  await manager.stop()
  await rm(directory, { recursive: true, force: true })
}

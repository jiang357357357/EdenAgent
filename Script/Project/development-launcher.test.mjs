import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { developmentHost } from './test-fixtures/development-host.mjs'
import workspaceIdentity from '../../frontend/desktop/src/processes/workspace-identity.cjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

async function waitUntil(condition, message, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await delay(50)
  }
  throw new Error(message)
}

test('the real CLI reuses an external Mon host and shuts down only its temporary local host and Vite', { timeout: 60000 }, async context => {
  const host = await developmentHost(workspaceIdentity.workspaceIdentity(root))
  const localPort = await freePort(), webPort = await freePort()
  const environment = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'HOME'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
  let output = '', errors = ''
  const child = fork(path.join(root, 'Script/Project/dev.mjs'), ['--web-only'], { cwd: root, execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...environment,
      EDEN_AGENT_MON_PORT: String(host.port), EDEN_AGENT_LOCAL_PORT: String(localPort), EDEN_AGENT_WEB_PORT: String(webPort),
      EDEN_AGENT_MON_DATA_ROOT: host.dataRoot, EDEN_AGENT_LOCAL_DATA_ROOT: path.join(host.root, 'local'),
    } })
  child.stdout.on('data', data => { output = (output + data).slice(-12000) })
  child.stderr.on('data', data => { errors = (errors + data).slice(-8000) })
  const exited = once(child, 'exit')
  async function close() {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.send('shutdown')
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
    try { await exited } finally { clearTimeout(timer) }
  }
  context.after(async () => { await close(); await host.close() })
  await waitUntil(() => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Launcher exited: ${output}\n${errors}`)
    return output.includes('TS runtime development started.')
  }, `Launcher never became ready: ${errors}`)
  assert.match(output, /复用本工作区 mon Agent/)
  assert.equal((await fetch(`http://127.0.0.1:${localPort}/healthz`)).status, 200)
  assert.equal((await fetch(`http://127.0.0.1:${webPort}/`)).status, 200)
  await delay(1000)
  assert.equal(child.exitCode, null)
  await close()
  const [code, signal] = await exited
  assert.equal(code, 0, errors)
  assert.equal(signal, null)
  await waitUntil(async () => {
    try { await fetch(`http://127.0.0.1:${localPort}/healthz`, { signal: AbortSignal.timeout(300) }); return false } catch { return true }
  }, 'Owned local server survived launcher shutdown', 5000)
  await waitUntil(async () => {
    try { await fetch(`http://127.0.0.1:${webPort}/`, { signal: AbortSignal.timeout(300) }); return false } catch { return true }
  }, 'Owned Vite survived launcher shutdown', 5000)
  assert.equal(await (await fetch(`http://127.0.0.1:${host.port}/probe`)).text(), 'alive')
  assert.equal(host.state.rpcMessages, 0)
  assert.equal(host.state.upgrades, 1)
})

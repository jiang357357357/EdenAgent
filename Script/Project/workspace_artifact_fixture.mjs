import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { serverDependencyPlan } from './server_dependency_plan.mjs'

const capabilityToken = 'workspace-artifact-regression-token'.repeat(2)

/** Copy executable code/dependencies only, never an installation's Data or configuration. */
export async function copyArtifactRuntime(entry, portableRoot) {
  const sourceArtifact = fileURLToPath(new URL('../../dist/server/main.mjs', import.meta.url))
  const modules = path.join(path.dirname(path.dirname(entry)), 'node_modules')
  assert.ok(existsSync(modules) || path.resolve(entry) === path.resolve(sourceArtifact),
    'Missing runtime dependencies: a distribution artifact must supply its own node_modules')
  const destination = path.join(portableRoot, 'runtime', 'agent')
  await mkdir(path.join(destination, 'server'), { recursive: true })
  await cp(entry, path.join(destination, 'server', 'main.mjs'))
  const worker = path.join(path.dirname(entry), 'runtime-process.mjs')
  if (existsSync(worker)) await cp(worker, path.join(destination, 'server', 'runtime-process.mjs'))
  if (existsSync(modules)) await cp(modules, path.join(destination, 'node_modules'), { recursive: true, dereference: true })
  else {
    const repository = fileURLToPath(new URL('../../', import.meta.url))
    for (const dependency of serverDependencyPlan(repository)) {
      await cp(dependency.source, path.join(destination, 'node_modules', dependency.relative), {
        recursive: true, dereference: true, filter: source => path.basename(source) !== 'node_modules',
      })
    }
  }
  return path.join(destination, 'server', 'main.mjs')
}

export async function artifactHost(entry, root, dataRoot, { origin = 'local', coreUrl, model, serviceIdentity } = {}) {
  const child = fork(entry, [], { cwd: root, execPath: process.execPath, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
      TEMP: root, TMP: root, EDEN_AGENT_RUNTIME_ORIGIN: origin, EDEN_AGENT_DATA_ROOT: dataRoot,
      EDEN_AGENT_PORT: '0', EDEN_AGENT_CAPABILITY_TOKEN: capabilityToken, EDEN_AGENT_LOG_FORMAT: 'json',
      ...(coreUrl ? { MON_CORE_BASE_URL: coreUrl } : {}),
      ...(serviceIdentity ? { MON_SERVICE_SHARED_SECRET: serviceIdentity.secret, MON_SERVICE_USER_ID: serviceIdentity.userId } : {}),
      ...(model ? { EDEN_AGENT_MODEL: `${model.provider}/${model.id}`, EDEN_AGENT_BASE_URL: model.baseUrl } : {}),
      EDEN_AGENT_TERMINAL_SETTINGS_PATH: path.join(root, 'terminal-settings.json') } })
  let stderr = '', stdout = ''
  child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-8000) })
  const exited = once(child, 'exit')
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    if (child.exitCode !== null || child.signalCode !== null) {
      assert.equal(child.signalCode, null, stderr)
      assert.equal(child.exitCode, 0, stderr)
      return
    }
    child.send('shutdown')
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000)
    try {
      const [code, signal] = await exited
      assert.equal(signal, null, stderr)
      assert.equal(code, 0, stderr)
    } finally { clearTimeout(timer) }
  }
  try {
    const port = await new Promise((resolve, reject) => {
      // Fresh Windows copies need time for dependency loading and antivirus scans.
      // Keep this bounded, and retain startup diagnostics if the real artifact stalls.
      const timer = setTimeout(() => reject(new Error(`Artifact startup timeout: ${stderr}\n${stdout}`)), 45000)
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`Artifact exited before startup: ${stderr}`)) })
      child.stdout.on('data', chunk => {
        stdout += String(chunk)
        const lines = stdout.split('\n')
        stdout = lines.pop() ?? ''
        for (const line of lines) {
          let event
          try { event = JSON.parse(line) } catch { continue }
          if (event.event === 'server.listening' && typeof event.port === 'number') {
            clearTimeout(timer)
            resolve(event.port)
          }
        }
      })
    })
    return { port, close }
  } catch (error) {
    child.kill('SIGKILL')
    await exited
    throw error
  }
}

export async function artifactClient(host, { origin = 'local', coreToken } = {}) {
  const socket = new WebSocket(`ws://127.0.0.1:${host.port}/rpc`, ['eden-agent-rpc-v2', `eden-agent-token.${capabilityToken}`])
  await once(socket, 'open')
  let nextId = 0
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => {
      socket.off('message', receive)
      reject(new Error(`RPC timed out: ${method}`))
    }, 10000)
    const receive = data => {
      const value = JSON.parse(data.toString())
      if (value.id !== id) return
      clearTimeout(timer)
      socket.off('message', receive)
      if (value.error) { const error = new Error(`${method}: ${value.error.message}`); error.data = value.error.data; reject(error) }
      else resolve(value.result)
    }
    socket.on('message', receive)
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
  try {
    await rpc('initialize', { protocolVersion: 2, runtimeOrigin: origin, clientName: 'artifact-recovery',
      clientVersion: '1', capabilities: [], ...(coreToken ? { coreToken } : {}) })
  } catch (error) { socket.terminate(); throw error }
  return { rpc, close: () => socket.terminate() }
}

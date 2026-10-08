import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const artifact = fileURLToPath(new URL('../../dist/server/main.mjs', import.meta.url))
const token = 'logging-artifact-private-capability-token'.repeat(2)

function processEnvironment(root, origin, environment = {}) {
  return { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    TEMP: root, TMP: root, EDEN_AGENT_RUNTIME_ORIGIN: origin, EDEN_AGENT_DATA_ROOT: path.join(root, origin),
    EDEN_AGENT_PORT: '0', EDEN_AGENT_CAPABILITY_TOKEN: token,
    EDEN_AGENT_TERMINAL_SETTINGS_PATH: path.join(root, 'terminal-settings.json'), ...environment }
}

async function fixture(context) {
  assert.ok(existsSync(artifact), 'Build dist/server/main.mjs before running the logging artifact tests')
  const root = await mkdtemp(path.join(tmpdir(), 'eden-logging-artifact-'))
  const hosts = []
  context.after(async () => {
    try { await Promise.all(hosts.map(host => host.close())) }
    finally {
      assert.equal(path.dirname(root), path.resolve(tmpdir()))
      assert.ok(path.basename(root).startsWith('eden-logging-artifact-'))
      await rm(root, { recursive: true, force: true })
    }
  })
  return { root, launch: async (origin = 'local', environment = {}) => {
    const host = await launch(root, origin, environment)
    hosts.push(host)
    return host
  } }
}

async function launch(root, origin, environment) {
  const dataRoot = path.join(root, origin)
  const child = fork(artifact, [], {
    cwd: root, execPath: process.execPath, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: processEnvironment(root, origin, environment),
  })
  let stdout = '', stderr = '', closed = false
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  const exited = once(child, 'close')
  async function close() {
    if (closed) return
    closed = true
    if (child.connected) child.send('shutdown')
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000)
    try {
      const [code, signal] = await exited
      assert.equal(signal, null, stderr)
      assert.equal(code, 0, stderr)
    } finally { clearTimeout(timer) }
  }
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error(`Artifact IPC readiness timeout: ${stderr}`)), 15000)
      function cleanup() {
        clearTimeout(timer)
        child.off('message', receive)
        child.off('exit', earlyExit)
        child.off('error', fail)
      }
      function fail(error) { cleanup(); reject(error) }
      function earlyExit() { fail(new Error(`Artifact exited before IPC readiness: ${stderr}`)) }
      function receive(message) {
        if (message?.type !== 'eden-agent.ready') return
        cleanup()
        resolve(message)
      }
      child.on('message', receive)
      child.once('exit', earlyExit)
      child.once('error', fail)
    })
    assert.equal(ready.origin, origin)
    assert.equal(ready.pid, child.pid)
    assert.ok(Number.isInteger(ready.port) && ready.port > 0)
    return { port: ready.port, pid: child.pid, origin, dataRoot, close,
      stdout: () => stdout, stderr: () => stderr }
  } catch (error) {
    child.kill('SIGKILL')
    await exited
    throw error
  }
}

async function health(host) {
  const response = await fetch(`http://127.0.0.1:${host.port}/healthz`, { signal: AbortSignal.timeout(5000) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).runtimeOrigin, host.origin)
}

async function verifyLocalRpc(host) {
  const socket = new WebSocket(`ws://127.0.0.1:${host.port}/rpc`, ['eden-agent-rpc-v2', `eden-agent-token.${token}`])
  const connectionTimeout = setTimeout(() => socket.terminate(), 5000)
  let nextId = 0
  async function rpc(method, params) {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off('message', receive); reject(new Error(`RPC timeout: ${method}`)) }, 5000)
      function receive(data) {
        const response = JSON.parse(data.toString())
        if (response.id !== id) return
        clearTimeout(timer)
        socket.off('message', receive)
        response.error ? reject(new Error(JSON.stringify(response.error))) : resolve(response.result)
      }
      socket.on('message', receive)
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }
  try {
    await once(socket, 'open')
    clearTimeout(connectionTimeout)
    await rpc('initialize', { protocolVersion: 2, runtimeOrigin: 'local', clientName: 'logging-artifact',
      clientVersion: '1', capabilities: [] })
    assert.deepEqual(await rpc('session.list', {}), [])
  } finally { clearTimeout(connectionTimeout); socket.terminate() }
}

async function records(host, directory = path.join(host.dataRoot, 'logs')) {
  const filename = `agent-${host.origin}-${host.pid}.jsonl`
  const source = await readFile(path.join(directory, filename), 'utf8')
  assert.equal(source.includes(token), false, 'Capability tokens must not enter the log file')
  const values = source.trim().split('\n').map(line => JSON.parse(line))
  assert.ok(values.length > 0)
  for (const value of values) {
    assert.equal(value.origin, host.origin)
    assert.equal(value.pid, host.pid)
    assert.ok(['debug', 'info', 'warn', 'error'].includes(value.level))
    assert.ok(Number.isFinite(Date.parse(value.time)))
  }
  if (host.port !== undefined) assert.equal(values.find(value => value.event === 'server.listening')?.port, host.port)
  assert.equal(host.stdout().includes(token), false)
  assert.equal(host.stderr().includes(token), false)
  return values
}

test('the bundle defaults to Chinese console logs, records JSONL, and serves RPC before clean IPC shutdown', { timeout: 45000 }, async context => {
  const setup = await fixture(context)
  const host = await setup.launch()
  await health(host)
  await verifyLocalRpc(host)
  await host.close()
  assert.match(host.stdout(), /\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] \[Agent\/尘世\]/)
  assert.match(host.stdout(), /服务已就绪/)
  assert.doesNotMatch(host.stdout(), /^\s*\{/m, 'Default console output must not contain raw JSON lines')
  assert.match(host.stderr(), /\[WARN\]/)
  assert.match(host.stderr(), /ExperimentalWarning/)
  assert.match(host.stderr(), /Node\.js 运行提示/)
  const values = await records(host)
  assert.ok(values.some(value => value.event === 'process.warning' && value.level === 'warn' && value.warningName === 'ExperimentalWarning'))
})

test('explicit JSON console mode preserves server.listening for existing machine consumers', { timeout: 45000 }, async context => {
  const setup = await fixture(context)
  const host = await setup.launch('local', { EDEN_AGENT_LOG_FORMAT: 'json' })
  await health(host)
  await verifyLocalRpc(host)
  await host.close()
  const output = host.stdout().trim().split('\n').map(line => JSON.parse(line))
  assert.equal(output.find(value => value.event === 'server.listening')?.port, host.port)
  assert.ok(output.every(value => value.origin === 'local' && value.pid === host.pid))
  const warnings = host.stderr().trim().split('\n').map(line => JSON.parse(line))
  assert.ok(warnings.some(value => value.event === 'process.warning' && value.warningName === 'ExperimentalWarning'))
  assert.ok(warnings.every(value => ['warn', 'error'].includes(value.level)))
  await records(host)
})

test('two worlds use distinct process files in the Mon log batch and an explicit log directory overrides it', { timeout: 60000 }, async context => {
  const setup = await fixture(context)
  const batch = path.join(setup.root, 'mon-log-batch')
  const logDirectory = path.join(batch, 'Text', 'MonAgent')
  const local = await setup.launch('local', { MON_LOG_START_DIR: batch })
  const mon = await setup.launch('mon', { MON_LOG_START_DIR: batch })
  assert.notEqual(local.pid, mon.pid)
  assert.notEqual(local.port, mon.port)
  await Promise.all([health(local), health(mon)])
  await Promise.all([local.close(), mon.close()])
  assert.match(mon.stdout(), /\[Agent\/伊甸园\]/)
  await records(local, logDirectory)
  await records(mon, logDirectory)
  assert.equal((await readdir(logDirectory)).filter(name => name.endsWith('.jsonl')).length, 2)
  assert.equal(existsSync(path.join(local.dataRoot, 'logs')), false)
  assert.equal(existsSync(path.join(mon.dataRoot, 'logs')), false)
  const override = path.join(setup.root, 'explicit-logs')
  const restarted = await setup.launch('local', { MON_LOG_START_DIR: batch, EDEN_AGENT_LOG_DIR: override })
  await health(restarted)
  await restarted.close()
  await records(restarted, override)
  assert.equal((await readdir(logDirectory)).filter(name => name.endsWith('.jsonl')).length, 2)
  assert.equal(existsSync(path.join(logDirectory, `agent-local-${restarted.pid}.jsonl`)), false)
})

test('invalid startup configuration exits with formatted diagnostics and never reports ready', { timeout: 30000 }, async context => {
  const setup = await fixture(context)
  const child = fork(artifact, [], {
    cwd: setup.root, execPath: process.execPath, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: processEnvironment(setup.root, 'local', { EDEN_AGENT_PORT: 'invalid' }),
  })
  let stdout = '', stderr = ''
  const messages = []
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  child.on('message', message => messages.push(message))
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000)
  let code, signal
  try { [code, signal] = await once(child, 'close') }
  finally { clearTimeout(timeout) }
  assert.equal(signal, null, stderr)
  assert.equal(code, 1, stderr)
  assert.equal(messages.some(message => message?.type === 'eden-agent.ready'), false)
  assert.match(stderr, /\[ERROR\] \[Agent\/尘世\] 服务启动失败/)
  assert.doesNotMatch(stderr, /^\s*\{/m)
  const values = await records({ origin: 'local', pid: child.pid, dataRoot: path.join(setup.root, 'local'),
    stdout: () => stdout, stderr: () => stderr })
  assert.ok(values.some(value => value.event === 'server.startup.failed' && value.level === 'error'))
  assert.equal(values.some(value => value.event === 'server.listening'), false)
})

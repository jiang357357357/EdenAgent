import assert from 'node:assert/strict'
import test from 'node:test'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { WebSocket } from 'ws'
import identity from '../../frontend/desktop/src/processes/workspace-identity.cjs'

const require = createRequire(import.meta.url)
const { verifyWorkspaceEndpoint } = require('../../frontend/desktop/src/processes/verify-workspace-endpoint.cjs')
const { createRealmRpc } = require('../../frontend/desktop/src/processes/realm-rpc.cjs')
const repository = fileURLToPath(new URL('../../', import.meta.url))
const artifact = process.env.EDEN_AGENT_WORKSPACE_ARTIFACT
const capability = 'workspace-identity-fixture-capability-only'.repeat(2)

async function launch(entry, root, coreUrl, source) {
  const child = fork(entry, [], { cwd: repository, execArgv: source ? ['--import', 'tsx'] : [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
      TEMP: root, TMP: root, MON_WORKSPACE_ROOT: root, MON_CORE_BASE_URL: coreUrl,
      // An inherited DLC path must not redirect this installation's discovery.
      MON_SHARED_WORKSPACE_DLC_ROOT: path.join(tmpdir(), 'wrong-workspace-dlc'),
      EDEN_AGENT_DATA_ROOT: path.join(root, 'Data', 'Agent'), EDEN_AGENT_PORT: '0',
      EDEN_AGENT_RUNTIME_ORIGIN: 'mon', EDEN_AGENT_CAPABILITY_TOKEN: capability,
      EDEN_AGENT_LOG_FORMAT: 'json', EDEN_AGENT_TERMINAL_SETTINGS_PATH: path.join(root, 'terminal.json'),
    } })
  const exit = once(child, 'exit')
  let stderr = '', pending = ''
  child.stderr.on('data', value => { stderr = (stderr + value).slice(-4000) })
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.send('shutdown')
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000)
    try { assert.deepEqual(await exit, [0, null], stderr) } finally { clearTimeout(timer) }
  }
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup timeout: ${stderr}`)), 20000)
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`Startup exited: ${stderr}`)) })
      child.stdout.on('data', value => {
        pending += value
        const lines = pending.split('\n'); pending = lines.pop() || ''
        for (const line of lines) {
          try {
            const event = JSON.parse(line)
            if (event.event === 'server.listening') { clearTimeout(timer); resolve(event.port) }
          } catch {}
        }
      })
    })
    return { close, pid: child.pid, token: capability, origin: 'mon', workspaceId: identity.workspaceIdentity(root).workspaceId,
      baseUrl: `http://127.0.0.1:${port}` }
  } catch (error) { child.kill('SIGKILL'); await exit; throw error }
}

test('source and compiled processes reject crossed installations and keep DLC enablement independent', { timeout: 60000 }, async context => {
  assert.ok(artifact, 'Set EDEN_AGENT_WORKSPACE_ARTIFACT to the candidate or installed compiled main.mjs')
  const root = await mkdtemp(path.join(tmpdir(), 'eden-workspace-process-'))
  const portable = path.join(root, 'EDEN-portable', 'EDEN_win')
  const hosts = [], clients = []
  let profiles = 0, sharedRequests = 0
  const core = createServer((request, response) => {
    if (request.url === '/api/users/me/profile/' && request.headers.authorization === 'Token workspace-fixture-account') {
      profiles++; response.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"fixture-user"}')
    } else if (request.url === '/api/shared-workspace/v1/capabilities') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"protocolVersion":1,"maxFileBytes":16777216}')
    } else { sharedRequests++; response.writeHead(404).end() }
  })
  core.listen(0, '127.0.0.1'); await once(core, 'listening')
  context.after(async () => {
    for (const client of clients) client.close()
    await Promise.all(hosts.map(host => host.close()))
    core.closeAllConnections(); await new Promise(resolve => core.close(resolve))
    await rm(root, { recursive: true, force: true })
  })
  for (const workspace of [root, portable]) {
    await mkdir(path.join(workspace, '.run', 'dlc'), { recursive: true })
    await writeFile(path.join(workspace, '.monconfig'), '')
    await writeFile(path.join(workspace, '.monworkspace'), '{}')
    const dlc = path.join(workspace, 'DLC', 'SharedWorkspace')
    await mkdir(dlc, { recursive: true })
    await writeFile(path.join(dlc, 'package.json'), '{"type":"module"}')
    await writeFile(path.join(dlc, 'dlc-manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'shared-workspace',
      publisher: { capability: 'workspace.publish.v2' }, capabilities: ['workspace.publish.v2'], transport: 'lan', protocolVersion: 2 }))
    await writeFile(path.join(workspace, '.run', 'dlc', 'state.json'), JSON.stringify({ enabled: { 'shared-workspace': workspace === portable } }))
  }
  const coreUrl = `http://127.0.0.1:${core.address().port}`
  const source = await launch(path.join(repository, 'Server', 'src', 'main.ts'), root, coreUrl, true); hosts.push(source)
  const compiled = await launch(path.resolve(artifact), portable, coreUrl, false); hosts.push(compiled)
  assert.notEqual(source.workspaceId, compiled.workspaceId)
  for (const [host, wrong] of [[source, compiled], [compiled, source]]) {
    const health = await (await fetch(`${host.baseUrl}/healthz`)).json()
    assert.equal(health.workspaceId, host.workspaceId)
    assert.ok(!JSON.stringify(health).includes(root), 'Health must not expose installation paths')
    await assert.rejects(verifyWorkspaceEndpoint({ ...host, workspaceId: wrong.workspaceId }), /其他 EDEN 工作区/)
    assert.equal((await verifyWorkspaceEndpoint(host)).workspaceId, host.workspaceId)
    const rejected = createRealmRpc({ capability: () => ({ ...host, workspaceId: wrong.workspaceId }),
      coreToken: () => 'workspace-fixture-account', WebSocketClass: WebSocket })
    await assert.rejects(rejected('mon', 'desktop.reminder.list'), /其他 EDEN 工作区/)
    rejected.close()
  }
  assert.equal(profiles, 0, 'Crossed identity must fail before Core authentication or account/DLC initialization')
  for (const host of hosts) {
    const rpc = createRealmRpc({ capability: () => host, coreToken: () => 'workspace-fixture-account', WebSocketClass: WebSocket })
    clients.push(rpc)
    const session = await rpc('mon', 'session.create', { title: 'Isolated identity test' })
    const status = await rpc('mon', 'sharedWorkspace.status', { sessionId: session.id })
    assert.equal(status.available, true, JSON.stringify({ phase: host === compiled ? 'compiled' : 'source', status }))
    assert.equal(status.canPublish, host === compiled)
    if (host === source) assert.match(status.publishReason, /尚未启用/)
    host.rpc = rpc; host.sessionId = session.id
    assert.deepEqual(await rpc('mon', 'desktop.reminder.list'), [])
  }
  await writeFile(path.join(root, '.run', 'dlc', 'state.json'), '{"enabled":{"shared-workspace":true}}')
  assert.equal((await source.rpc('mon', 'sharedWorkspace.status', { sessionId: source.sessionId })).canPublish, true)
  await writeFile(path.join(portable, '.run', 'dlc', 'state.json'), '{"enabled":{"shared-workspace":false}}')
  assert.equal((await compiled.rpc('mon', 'sharedWorkspace.status', { sessionId: compiled.sessionId })).canPublish, false)
  assert.equal((await compiled.rpc('mon', 'sharedWorkspace.status', { sessionId: compiled.sessionId })).available, true)
  assert.equal((await source.rpc('mon', 'sharedWorkspace.status', { sessionId: source.sessionId })).canPublish, true)
  assert.equal(sharedRequests, 0, 'No fixture files are shared or synced by these status checks')
  console.log(JSON.stringify({ scope: 'real source and compiled Node child processes; loopback RPC and production desktop bridge',
    sourcePid: source.pid, compiledPid: compiled.pid, healthIdentity: 'passed', crossedConnections: 'rejected before Core auth',
    independentDlcState: 'passed', nativeGui: 'not covered' }))
})

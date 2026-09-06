// Real server/process/RPC verification with a deterministic local model fixture.
// Does not use real model credentials or the user's realm data.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EdenAgentRpcClient } from '../../frontend/web/src/generated/eden-agent-rpc.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const binary = process.env.EDEN_LIVE_SERVER_BINARY || path.join(root, 'target/debug', process.platform === 'win32' ? 'eden-agent-server.exe' : 'eden-agent-server')
const scratch = await mkdtemp(path.join(tmpdir(), 'eden-command-live-'))
const report = { startedAt: new Date().toISOString(), platform: process.platform, model: 'deterministic local HTTP fixture (not a real LLM)', scratch, checks: [] }
console.log(`Evidence directory: ${scratch}`)
const plans = new Map()
const children = new Set()
const clients = new Set()
let modelRequests = 0
let caseNumber = 0
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(fn, label, timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(50) }
  throw new Error(`Timed out: ${label}`)
}
async function exists(file) { try { await access(file); return true } catch { return false } }
async function check(name, fn) {
  const start = Date.now()
  try { const evidence = await fn(); report.checks.push({ name, passed: true, ms: Date.now() - start, evidence }); console.log(`PASS ${name}`) }
  catch (error) { report.checks.push({ name, passed: false, error: String(error) }); throw error }
}
async function port() {
  const server = createTcpServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const value = server.address().port; await new Promise((resolve) => server.close(resolve)); return value
}
function quote(value) { return `'${value.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''")}'` }
const shell = process.platform === 'win32' ? 'powershell' : 'bash'
const writeMarker = (file, content) => process.platform === 'win32'
  ? `[IO.File]::WriteAllText(${quote(file)}, ${quote(content)}); Write-Output ${quote(content)}`
  : `printf %s ${quote(content)} > ${quote(file)}; printf %s ${quote(content)}`
function shellStep(command) { return { name: shell, arguments: { command, yield_time_ms: 1000 } } }

const fixture = createServer(async (request, response) => {
  try {
    if (request.url === '/ping') { response.end('eden-network-ok'); return }
    let body = ''; for await (const chunk of request) body += chunk
    const payload = JSON.parse(body); modelRequests++
    const messages = payload.messages || []
    const id = messages.filter((message) => message.role === 'user').map((message) => JSON.stringify(message.content)).join('\n').match(/EDEN_LIVE_CASE:(case\d+)/)?.[1]
    const plan = payload.tools?.length ? plans.get(id) : undefined
    const results = messages.filter((message) => message.role === 'tool')
    let step = plan?.[results.length]
    if (typeof step === 'function') step = await step(results)
    if (step) assert.ok(payload.tools.some((tool) => tool.function.name === step.name), `tool ${step.name} must be in the actual model tool catalog`)
    const message = step
      ? { role: 'assistant', content: null, tool_calls: [{ id: `${id}_${results.length}`, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.arguments) } }] }
      : { role: 'assistant', content: 'Live verification complete.' }
    const finish_reason = step ? 'tool_calls' : 'stop'
    if (payload.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const delta = step ? { ...message, tool_calls: message.tool_calls.map((tool, index) => ({ index, ...tool })) } : message
      response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } })}\n\ndata: [DONE]\n\n`)
    } else {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ choices: [{ index: 0, message, finish_reason }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }))
    }
  } catch (error) { response.writeHead(500); response.end(String(error)) }
})
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve))
const fixturePort = fixture.address().port

class Client extends EdenAgentRpcClient {
  constructor() {
    super()
    this.events = []
    this.on('session.event', (event) => this.events.push(event))
    clients.add(this)
  }
  async request(method, params = {}) {
    let timer
    try {
      return await Promise.race([
        super.request(method, params),
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`RPC timeout: ${method}`)), 12_000) }),
      ])
    } finally { clearTimeout(timer) }
  }
  close() { super.close(); clients.delete(this) }
}
async function connect(server, origin = server.origin, token = server.token) {
  const client = new Client()
  try {
    await client.connect(`ws://127.0.0.1:${server.port}/rpc`, token, 'live-verification', origin)
    return client
  } catch (error) { client.close(); throw error }
}
async function start(origin, previous) {
  const directory = previous?.directory || path.join(scratch, origin)
  const workspace = path.join(directory, 'workspace'); await mkdir(workspace, { recursive: true })
  await mkdir(path.join(directory, 'empty-manifests'), { recursive: true })
  await mkdir(path.join(directory, 'empty-skills'), { recursive: true })
  const token = previous?.token || randomBytes(32).toString('hex')
  const bindPort = await port()
  const environment = Object.fromEntries(['PATH', 'HOME', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]))
  Object.assign(environment, {
    EDEN_AGENT_MODEL: 'openai/eden-live-fixture', OPENAI_API_KEY: 'local-test-only', EDEN_AGENT_BASE_URL: `http://127.0.0.1:${fixturePort}/v1`,
    EDEN_AGENT_MODEL_MAX_RETRIES: '0', EDEN_AGENT_MAX_OUTPUT_TOKENS: '512', EDEN_AGENT_MODEL_TIMEOUT_SECONDS: '15',
    EDEN_AGENT_CONNECTOR_MANIFEST_ROOT: path.join(directory, 'empty-manifests'), EDEN_AGENT_CONNECTOR_PACKAGE_ROOT: path.join(directory, 'connector-packages'), EDEN_AGENT_CONNECTOR_DATA_ROOT: path.join(directory, 'connector-runtime'),
  })
  const args = ['--bind', `127.0.0.1:${bindPort}`, '--runtime-origin', origin, '--capability-token', token,
    '--database', path.join(directory, 'runtime.db'), '--token-file', path.join(directory, 'capability.token'), '--log-directory', path.join(directory, 'logs'),
    '--blob-root', path.join(directory, 'blobs'), '--workspace-root', workspace, '--skill-roots', path.join(directory, 'empty-skills'),
    '--skill-install-root', path.join(directory, 'skills'), '--plugin-root', path.join(directory, 'plugins'), '--legacy-core-database', path.join(directory, 'nonexistent-legacy.db')]
  const output = createWriteStream(path.join(directory, `server-${Date.now()}.log`))
  const child = spawn(binary, args, { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  children.add(child); child.stdout.pipe(output); child.stderr.pipe(output, { end: false }); child.once('exit', () => { output.end(); children.delete(child) })
  child.on('error', (error) => { console.error(error.message) })
  await until(async () => {
    if (child.exitCode != null) throw new Error(`Server startup failed, see ${directory}`)
    try { const response = await fetch(`http://127.0.0.1:${bindPort}/healthz`, { signal: AbortSignal.timeout(500) }); return response.ok } catch { return false }
  }, `${origin} health`)
  const server = { directory, workspace, token, port: bindPort, origin, child }
  server.client = await connect(server)
  return server
}
async function stop(server, signal = 'SIGTERM') {
  server.client.close(); server.child.kill(signal)
  await until(() => server.child.exitCode != null || server.child.signalCode != null, 'server shutdown', 10_000)
}
async function begin(server, steps) {
  const id = `case${++caseNumber}`; plans.set(id, steps)
  const session = await server.client.request('session.create', { title: id, participants: [{ assistantId: 'live-assistant', assistantName: 'Live verification', profile: { name: 'Live verification' } }] })
  const turn = await server.client.request('turn.start', { sessionId: session.id, text: `EDEN_LIVE_CASE:${id} Execute the configured verification steps.` })
  return { sessionId: session.id, turnId: turn.turnId }
}
async function finish(server, turn) {
  const completed = await until(() => server.client.events.find((event) => event.turnId === turn.turnId && ['turn.completed', 'turn.failed'].includes(event.eventType)), 'turn completion', 35_000)
  assert.equal(completed.eventType, 'turn.completed', JSON.stringify(completed.payload))
  return server.client.events.filter((event) => event.turnId === turn.turnId && event.eventType === 'agent.tool_execution_end')
}
async function permission(server, turn) {
  return until(async () => (await server.client.request('permission.list', { sessionId: turn.sessionId }))[0], 'permission request')
}
const host = { mode: 'host', confirmHostExecution: true, networkAccess: false, writableRoots: [] }
let local, mon
try {
  local = await start('local'); mon = await start('mon')
  await check('real WebSocket authentication and realm checks', async () => {
    await assert.rejects(connect(local, 'local', 'incorrect-token-01234567890123456789'))
    await assert.rejects(connect(local, 'mon'))
    return { localPort: local.port, monPort: mon.port }
  })
  await check('default execution status and Linux sandbox startup probe', async () => {
    const status = await local.client.request('command.execution.get'); assert.equal(status.mode, 'sandbox')
    const ready = await (await fetch(`http://127.0.0.1:${local.port}/readyz`)).json()
    assert.equal(ready.checks.commandExecution.ready, status.available)
    report.sandbox = status
    return { status, readiness: ready.checks.processSandbox }
  })
  if (!report.sandbox.available) await check('disabled sandbox rejects an actual tool call without a side effect', async () => {
    const marker = path.join(local.workspace, 'blocked.txt')
    const turn = await begin(local, [shellStep(writeMarker(marker, 'must-not-run'))])
    const results = await finish(local, turn)
    assert.equal(results[0].payload.error.code, 'command_execution_unavailable'); assert.equal(await exists(marker), false)
    return results[0].payload.error
  })
  await check('host execution requires explicit confirmation and remains realm-local', async () => {
    await assert.rejects(local.client.request('command.execution.set', { mode: 'host' }), /确认/)
    assert.equal((await local.client.request('command.execution.get')).mode, 'sandbox')
    await local.client.request('command.execution.set', host)
    assert.equal((await mon.client.request('command.execution.get')).mode, 'sandbox')
    assert.equal((await local.client.request('permission.mode.get')).mode, 'restricted')
  })
  await check('real command waits for approval, then writes a UTF-8 file', async () => {
    await local.client.request('permission.mode.set', { mode: 'full_access' })
    const marker = path.join(local.workspace, 'approved.txt')
    const counter = path.join(local.workspace, 'execution-count.txt')
    const append = process.platform === 'win32' ? `; Add-Content -LiteralPath ${quote(counter)} -Value executed` : `; printf 'executed\n' >> ${quote(counter)}`
    const turn = await begin(local, [shellStep(writeMarker(marker, '终端真实执行 ✓') + append)])
    const request = await permission(local, turn)
    assert.equal(request.capability, 'shell.host.execute'); assert.equal(await exists(marker), false)
    await local.client.request('permission.resolve', { requestId: request.id, decision: 'once' })
    const results = await finish(local, turn); assert.equal(results[0].payload.isError, false)
    assert.equal(await readFile(marker, 'utf8'), '终端真实执行 ✓')
    report.replaySession = turn.sessionId
    return { sessionId: turn.sessionId, commandResult: results[0].payload.result.details }
  })
  await check('denied approval prevents the actual file write', async () => {
    const marker = path.join(local.workspace, 'denied.txt')
    const turn = await begin(local, [shellStep(writeMarker(marker, 'must-not-run'))])
    const request = await permission(local, turn)
    await local.client.request('permission.resolve', { requestId: request.id, decision: 'deny' })
    const results = await finish(local, turn)
    assert.equal(results[0].payload.error.code, 'permission_denied'); assert.equal(await exists(marker), false)
  })
  await check('a pending approval cannot be reused after execution settings change', async () => {
    const marker = path.join(local.workspace, 'stale.txt')
    const turn = await begin(local, [shellStep(writeMarker(marker, 'must-not-run'))])
    const request = await permission(local, turn)
    await local.client.request('command.execution.set', { ...host, networkAccess: true })
    await local.client.request('permission.resolve', { requestId: request.id, decision: 'once' })
    const results = await finish(local, turn)
    assert.equal(results[0].payload.error.code, 'command_policy_changed'); assert.equal(await exists(marker), false)
    await local.client.request('command.execution.set', host)
  })
  await local.client.request('permission.mode.set', { mode: 'takeover' })
  await check('automatic host command can access an explicitly tested path outside the workspace', async () => {
    const marker = path.join(local.directory, 'outside-workspace.txt')
    const turn = await begin(local, [shellStep(writeMarker(marker, 'outside-ok'))])
    const results = await finish(local, turn); assert.equal(results[0].payload.isError, false)
    assert.equal(await readFile(marker, 'utf8'), 'outside-ok')
    assert.equal((await local.client.request('permission.list', { sessionId: turn.sessionId })).length, 0)
  })
  await check('nonzero command exits return an error with the real exit code', async () => {
    const turn = await begin(local, [shellStep('exit 7')]); const results = await finish(local, turn)
    assert.equal(results[0].payload.error.code, 'command_failed'); assert.equal(results[0].payload.result.details.exit_code, 7)
  })
  await check('write_stdin sends UTF-8 input to a real waiting process', async () => {
    const command = process.platform === 'win32' ? '$line = [Console]::ReadLine(); Write-Output $line' : 'IFS= read -r line; printf "%s" "$line"'
    const turn = await begin(local, [shellStep(command), (results) => {
      const sessionId = results[0].content.match(/proc_[a-f0-9]+/)?.[0]; assert.ok(sessionId)
      return { name: 'write_stdin', arguments: { session_id: sessionId, chars: '真实输入 input-ok\n', yield_time_ms: 1000 } }
    }])
    const results = await finish(local, turn)
    assert.equal(results.length, 2); assert.equal(results[1].payload.isError, false)
    assert.equal(results[1].payload.result.details.status, 'completed')
    assert.match(JSON.stringify(results[1].payload.result.content), /真实输入 input-ok/)
  })
  await check('long-running process blocks mode changes and write_stdin terminates it', async () => {
    let release; const gate = new Promise((resolve) => { release = resolve })
    const command = process.platform === 'win32' ? 'Write-Output start; Start-Sleep -Seconds 30' : 'printf start; sleep 30'
    const turn = await begin(local, [shellStep(command), async (results) => {
      await gate
      const sessionId = results[0].content.match(/proc_[a-f0-9]+/)?.[0]; assert.ok(sessionId)
      return { name: 'write_stdin', arguments: { session_id: sessionId, terminate: true, yield_time_ms: 1000 } }
    }])
    try {
      const first = await until(() => local.client.events.find((event) => event.turnId === turn.turnId && event.eventType === 'agent.tool_execution_end'), 'yielded process')
      assert.equal(first.payload.result.details.status, 'running')
      await assert.rejects(local.client.request('command.execution.set', { mode: 'sandbox' }), /进程|执行/)
    } finally { release() }
    const results = await finish(local, turn)
    assert.equal(results.length, 2); assert.equal(results[1].payload.isError, false)
    assert.equal(results[1].payload.result.details.status, 'completed')
    await local.client.request('command.execution.set', { mode: 'sandbox' })
    await local.client.request('command.execution.set', host)
  })
  await check('host commands can reach a real loopback HTTP service', async () => {
    const url = `http://127.0.0.1:${fixturePort}/ping`
    const command = process.platform === 'win32' ? `(Invoke-WebRequest -UseBasicParsing ${quote(url)}).Content` : `${quote(process.execPath)} -e ${quote(`fetch(${JSON.stringify(url)}).then(r=>r.text()).then(console.log)` )}`
    const turn = await begin(local, [shellStep(command)]); const results = await finish(local, turn)
    assert.equal(results[0].payload.isError, false); assert.match(JSON.stringify(results[0].payload.result.content), /eden-network-ok/)
  })
  await check('crash/restart restores settings and durable events without replaying completed commands', async () => {
    const before = await local.client.request('event.list', { sessionId: report.replaySession, afterSeq: 0, limit: 500 })
    await stop(local, 'SIGKILL'); local = await start('local', local)
    assert.equal((await local.client.request('command.execution.get')).mode, 'host')
    assert.equal((await local.client.request('permission.mode.get')).mode, 'takeover')
    const after = await local.client.request('event.list', { sessionId: report.replaySession, afterSeq: 0, limit: 500 })
    assert.deepEqual(after.items.map((event) => event.id), before.items.map((event) => event.id))
    assert.equal(await readFile(path.join(local.workspace, 'approved.txt'), 'utf8'), '终端真实执行 ✓')
    assert.equal((await readFile(path.join(local.workspace, 'execution-count.txt'), 'utf8')).trim(), 'executed')
    assert.equal((await mon.client.request('command.execution.get')).mode, 'sandbox')
    return { eventsRecovered: after.items.length, committedCommandExecutions: 1 }
  })
} catch (error) {
  report.error = error.stack; console.error(error.stack); process.exitCode = 1
} finally {
  for (const client of clients) client.close()
  for (const child of children) child.kill('SIGTERM')
  await until(() => children.size === 0, 'test process cleanup', 10_000).catch(() => { for (const child of children) child.kill('SIGKILL') })
  fixture.closeAllConnections(); await new Promise((resolve) => fixture.close(resolve))
  report.modelRequests = modelRequests; report.finishedAt = new Date().toISOString()
  await writeFile(path.join(scratch, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`Report: ${path.join(scratch, 'report.json')}`)
}

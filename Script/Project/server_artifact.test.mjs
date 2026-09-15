import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const artifact = fileURLToPath(new URL('../../dist/server/main.mjs', import.meta.url))
async function host(root, origin) {
  const token = (origin === 'local' ? 'l' : 'm').repeat(43)
  const child = fork(artifact, [], { cwd: root, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { PATH: process.env.PATH, EDEN_AGENT_RUNTIME_ORIGIN: origin, EDEN_AGENT_DATA_ROOT: path.join(root, origin),
      EDEN_AGENT_CAPABILITY_TOKEN: token, EDEN_AGENT_PORT: '0' } })
  let stderr = '', stdout = ''
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000) })
  const exit = once(child, 'exit')
  let closed = false
  async function close() {
    if (closed) return
    closed = true
    if (child.exitCode !== null || child.signalCode !== null) return
    child.send('shutdown')
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000)
    try { const [code, signal] = await exit; assert.equal(signal, null); assert.equal(code, 0, stderr) }
    finally { clearTimeout(timer) }
  }
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Artifact startup timeout: ${stderr}`)), 15000)
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`Artifact exited before listening: ${stderr}`)) })
      child.stdout.on('data', chunk => {
        stdout += chunk
        const lines = stdout.split('\n'); stdout = lines.pop()
        for (const line of lines) {
          let event; try { event = JSON.parse(line) } catch { continue }
          if (event.event === 'server.listening') { clearTimeout(timer); resolve(event.port) }
        }
      })
    })
    return { port, token, close }
  } catch (error) { child.kill('SIGKILL'); await exit; throw error }
}

async function client(server, origin) {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/rpc`, ['eden-agent-rpc-v2', `eden-agent-token.${server.token}`])
  await once(socket, 'open')
  let nextId = 0
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { socket.off('message', receive); reject(new Error(`RPC timeout: ${method}`)) }, 5000)
    function receive(data) {
      const value = JSON.parse(data.toString())
      if (value.id !== id) return
      clearTimeout(timer); socket.off('message', receive)
      value.error ? reject(new Error(JSON.stringify(value.error))) : resolve(value.result)
    }
    socket.on('message', receive); socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
  try { await rpc('initialize', { protocolVersion: 2, runtimeOrigin: origin, clientName: 'artifact-test', clientVersion: '1', capabilities: [] }) }
  catch (error) { socket.terminate(); throw error }
  return { rpc, close: () => socket.terminate() }
}

test('built dual hosts isolate sessions and blobs and preserve local state after process restart', { timeout: 60000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-artifact-live-'))
  const servers = [], clients = []
  t.after(async () => { for (const client of clients) client.close(); await Promise.all(servers.map(server => server.close())); await rm(root, { recursive: true, force: true }) })
  const local = await host(root, 'local'); servers.push(local)
  const mon = await host(root, 'mon'); servers.push(mon)
  const localClient = await client(local, 'local'); clients.push(localClient)
  const monClient = await client(mon, 'mon'); clients.push(monClient)
  const session = await localClient.rpc('session.create', { title: 'Persisted artifact session', participants: [] })
  assert.deepEqual(await monClient.rpc('session.list', {}), [])
  const upload = await fetch(`http://127.0.0.1:${local.port}/blobs`, { method: 'POST', headers: { Authorization: `Bearer ${local.token}`, 'Content-Type': 'text/plain' }, body: 'local-only' })
  assert.equal(upload.status, 200)
  const blob = await upload.json()
  assert.equal((await fetch(`http://127.0.0.1:${mon.port}/blobs/${blob.id}`, { headers: { Authorization: `Bearer ${mon.token}` } })).status, 404)
  assert.equal((await fetch(`http://127.0.0.1:${local.port}/blobs/${blob.id}`, { headers: { Authorization: `Bearer ${mon.token}` } })).status, 401)
  assert.equal((await localClient.rpc('skill.catalog_status', {})).error, null)
  for (const connection of [localClient, monClient]) {
    const skills = await connection.rpc('skill.list', {})
    assert.deepEqual(skills.map(skill => skill.name).sort(), ['eden-memory', 'eden-reminders', 'eden-self-awake', 'eden-workspace'])
    assert.ok(skills.every(skill => skill.content === null))
  }
  localClient.close(); await local.close()
  const restarted = await host(root, 'local'); servers.push(restarted)
  const restored = await client(restarted, 'local'); clients.push(restored)
  assert.equal((await restored.rpc('session.read', { sessionId: session.id })).title, 'Persisted artifact session')
  const download = await fetch(`http://127.0.0.1:${restarted.port}/blobs/${blob.id}`, { headers: { Authorization: `Bearer ${restarted.token}` } })
  assert.equal(await download.text(), 'local-only')
})

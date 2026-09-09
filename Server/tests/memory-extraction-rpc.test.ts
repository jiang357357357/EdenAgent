import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import os from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'
import { recordedModel } from '@eden/runtime-pi/testing'
import { websocketProtocol, tokenProtocolPrefix, memoryCandidatesPageSchema } from '@eden/api'
import { loadConfig } from '../src/bootstrap/config.ts'
import { startServer } from '../src/bootstrap/container.ts'
import { MemoryRepository } from '../src/modules/memories/index.ts'

function rpc(client: WebSocket, method: string, params: unknown): Promise<{ result: unknown; error: unknown }> {
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); client.off('message', receive); client.off('close', closed) }
    const closed = () => { cleanup(); reject(new Error('RPC connection closed')) }
    const receive = (bytes: Buffer) => {
      const response = JSON.parse(bytes.toString())
      if (response.id === id) { cleanup(); resolve(response) }
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error(`RPC timeout: ${method}`)) }, 5000)
    client.on('message', receive); client.once('close', closed)
    client.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

async function poll<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000
  let value = await read()
  while (!ready(value) && Date.now() < deadline) { await delay(10); value = await read() }
  assert.ok(ready(value), 'RPC state did not settle')
  return value
}

test('authenticated WebSocket candidate denial, explicit resume, approval and restart preserve a single extraction', async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-memory-rpc-'))
  const model = await recordedModel([{ text: 'Confirmed preference' },
    { text: '{"memories":[{"kind":"preference","content":"User prefers tea","confidence":0.95}]}' }])
  const config = { ...loadConfig({ EDEN_AGENT_V2_DATA_ROOT: root, EDEN_AGENT_PORT: '0' }), model: model.config }
  let host = await startServer(config)
  const other = await startServer(loadConfig({ EDEN_AGENT_RUNTIME_ORIGIN: 'mon', EDEN_AGENT_V2_DATA_ROOT: path.join(root, 'other'), EDEN_AGENT_PORT: '0' }))
  const sockets: WebSocket[] = []
  context.after(async () => { for (const socket of sockets) socket.terminate(); await Promise.all([host.close(), other.close()]); await model.close(); await rm(root, { recursive: true, force: true }) })
  const connect = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${host.port}/rpc`, [websocketProtocol, tokenProtocolPrefix + config.token])
    sockets.push(socket)
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
    assert.ok((await rpc(socket, 'memory.extraction.candidates', { sessionId: randomUUID() })).error)
    assert.equal((await rpc(socket, 'initialize', { protocolVersion: 2, runtimeOrigin: 'local', clientName: 'memory-test', clientVersion: '1', capabilities: [] })).error, null)
    return socket
  }
  const socket = await connect()
  const foreign = new WebSocket(`ws://127.0.0.1:${other.port}/rpc`, [websocketProtocol, tokenProtocolPrefix + config.token])
  sockets.push(foreign)
  const denied = await new Promise<number>((resolve, reject) => {
    foreign.on('error', () => {})
    foreign.once('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode!) })
    foreign.once('open', () => reject(new Error('Foreign realm token was accepted')))
  })
  assert.equal(denied, 401)
  foreign.terminate()
  const created = await rpc(socket, 'session.create', { title: 'Memory RPC', participants: [{ assistantId: 1, characterId: 11 }] })
  assert.equal(created.error, null)
  const sessionId = (created.result as { id: string }).id
  assert.equal((await rpc(socket, 'turn.start', { sessionId, text: 'I prefer tea' })).error, null)
  const permissions = async () => {
    const response = await rpc(socket, 'permission.list', { sessionId })
    assert.equal(response.error, null)
    return response.result as { id: string; state: string }[]
  }
  const initial = await poll(permissions, items => items.some(item => item.state === 'pending'))
  assert.equal((await rpc(socket, 'permission.resolve', { requestId: initial[0]!.id, decision: 'deny' })).error, null)
  const candidates = async () => {
    const response = await rpc(socket, 'memory.extraction.candidates', { sessionId })
    assert.equal(response.error, null)
    return memoryCandidatesPageSchema.parse(response.result)
  }
  const page = await poll(candidates, value => value.items.length === 1 && !value.items[0]!.processing)
  const candidate = page.items[0]!
  const params = { sessionId, jobId: candidate.id, revision: candidate.revision }
  assert.ok((await rpc(socket, 'memory.extraction.resume', { ...params, revision: '0'.repeat(64) })).error)
  assert.ok((await rpc(socket, 'memory.extraction.resume', { ...params, sessionId: randomUUID() })).error)
  assert.equal((await rpc(socket, 'memory.extraction.resume', params)).error, null)
  const resumed = await poll(permissions, items => items.some(item => item.state === 'pending'))
  assert.equal(resumed.length, 2)
  assert.equal((await rpc(socket, 'permission.resolve', { requestId: resumed.find(item => item.state === 'pending')!.id, decision: 'once' })).error, null)
  await poll(candidates, value => value.items.length === 0)
  assert.equal(model.requests.length, 2)
  socket.terminate(); await host.close(); host = await startServer(config)
  const restored = await connect()
  assert.deepEqual(memoryCandidatesPageSchema.parse((await rpc(restored, 'memory.extraction.candidates', { sessionId })).result).items, [])
  const memories = new MemoryRepository(host.sessions.repository.database).search({ scopeType: 'agent_character', scopeKey: '11' })
  assert.equal(memories[0]!.content, 'User prefers tea')
  assert.equal(model.requests.length, 2)
})

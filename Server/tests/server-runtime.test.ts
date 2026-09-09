import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'
import { recordedModel } from '@eden/runtime-pi/testing'
import { loadConfig } from '../src/bootstrap/config.ts'
import { startServer } from '../src/bootstrap/container.ts'
import { websocketProtocol, tokenProtocolPrefix } from '@eden/api'

async function connect(port: number, token: string, origin?: string): Promise<WebSocket> {
  const client = new WebSocket(`ws://127.0.0.1:${port}/rpc`, [websocketProtocol, tokenProtocolPrefix + token], origin ? { origin } : {})
  await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject) })
  return client
}

async function rpc(client: WebSocket, method: string, params: unknown): Promise<Record<string, unknown>> {
  const id = Math.random().toString()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.off('message', listener); reject(new Error(`RPC timeout: ${method}`)) }, 3000)
    const listener = (data: Buffer) => {
      const response = JSON.parse(data.toString()) as Record<string, unknown>
      if (response.id !== id) return
      clearTimeout(timer)
      client.off('message', listener)
      resolve(response)
    }
    client.on('message', listener)
    client.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

const initialize = (origin: string) => ({ protocolVersion: 2, runtimeOrigin: origin, clientName: 'test', clientVersion: '1', capabilities: [] })

test('authenticated websocket runs a durable turn and restores it after restart', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-server-'))
  const model = await recordedModel([{ text: 'A durable answer' }, { text: 'I remember' }])
  const config = { ...loadConfig({ EDEN_AGENT_V2_DATA_ROOT: directory, EDEN_AGENT_PORT: '0' }), model: model.config }
  let server = await startServer(config)
  try {
    const client = await connect(server.port, config.token)
    assert.ok((await rpc(client, 'session.list', {})).error)
    assert.ok((await rpc(client, 'initialize', initialize('mon'))).error)
    assert.equal((await rpc(client, 'initialize', initialize('local'))).error, null)
    const created = await rpc(client, 'session.create', { title: 'Test', participants: [] })
    const session = created.result as { id: string }
    const params = { sessionId: session.id, text: 'Remember me', attachments: [], idempotencyKey: 'same-input' }
    const accepted = await rpc(client, 'turn.start', params)
    await server.sessions.waitForIdle(session.id)
    const duplicate = await rpc(client, 'turn.start', params)
    assert.equal((accepted.result as { inputId: string }).inputId, (duplicate.result as { inputId: string }).inputId)
    await server.sessions.waitForIdle(session.id)
    assert.equal(model.requests.length, 1)
    const events = server.sessions.repository.events.list(session.id, '0', 1000)
    assert.ok(events.some(event => event.kind === 'turn.completed'))
    assert.deepEqual(events.map(event => Number(event.seq)), events.map((_, index) => index + 1))
    client.terminate()
    await server.close()
    server = await startServer(config)
    server.sessions.start(session.id, 'What did you say?')
    await server.sessions.waitForIdle(session.id)
    assert.match(JSON.stringify(model.requests[1]), /A durable answer/)
  } finally { await server.close(); await model.close(); rmSync(directory, { recursive: true }) }
})

test('rejects wrong tokens, hostile origins, and duplicate realm owners', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'eden-auth-'))
  const config = loadConfig({ EDEN_AGENT_V2_DATA_ROOT: directory, EDEN_AGENT_PORT: '0' })
  const server = await startServer(config)
  try {
    await assert.rejects(connect(server.port, 'x'.repeat(43)))
    await assert.rejects(connect(server.port, config.token, 'https://hostile.invalid'))
    await assert.rejects(startServer(config), /locked/)
    const ready = await fetch(`http://127.0.0.1:${server.port}/readyz`)
    assert.equal(ready.status, 503)
    const health = await fetch(`http://127.0.0.1:${server.port}/healthz`)
    assert.equal(health.status, 200)
  } finally { await server.close(); rmSync(directory, { recursive: true }) }
})

test('Mon configuration never inherits local model credentials', () => {
  const config = loadConfig({ EDEN_AGENT_RUNTIME_ORIGIN: 'mon', EDEN_AGENT_MODEL: 'private/model', OPENAI_API_KEY: 'local-test-key' })
  assert.equal(config.model, undefined)
  assert.equal(config.port, 40092)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'
import { recordedModel } from '@eden/runtime-pi/testing'
import { websocketProtocol, tokenProtocolPrefix, blobInfoSchema } from '@eden/api'
import { startServer } from '../src/bootstrap/container.ts'
import { loadConfig } from '../src/bootstrap/config.ts'

function rpc(client: WebSocket, method: string, params: unknown): Promise<Record<string, unknown>> {
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.off('message', listener); reject(new Error(`Timeout: ${method}`)) }, 5000)
    const listener = (data: Buffer) => {
      const response = JSON.parse(data.toString())
      if (response.id !== id) return
      clearTimeout(timer); client.off('message', listener); resolve(response)
    }
    client.on('message', listener); client.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  })
}

test('HTTP upload and authenticated RPC accept attachment-only input, execute file reads and replay after restart', async context => {
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII='
  const read = { action: 'read', blobId: '' }
  const model = await recordedModel([{ tool: 'eden_attachment', input: read }, { text: 'Read both attachments' }])
  const root = await mkdtemp(path.join(os.tmpdir(), 'eden-attachment-rpc-'))
  const config = { ...loadConfig({ EDEN_AGENT_V2_DATA_ROOT: root, EDEN_AGENT_PORT: '0' }), model: model.config }
  let server = await startServer(config)
  let client: WebSocket | undefined
  context.after(async () => { client?.terminate(); await server.close(); await model.close(); await rm(root, { recursive: true, force: true }) })
  const connect = async () => {
    client = new WebSocket(`ws://127.0.0.1:${server.port}/rpc`, [websocketProtocol, tokenProtocolPrefix + config.token])
    await new Promise<void>((resolve, reject) => { client!.once('open', resolve); client!.once('error', reject) })
    const initialized = await rpc(client, 'initialize', { protocolVersion: 2, runtimeOrigin: 'local', clientName: 'attachment-test', clientVersion: '1', capabilities: [] })
    assert.equal(initialized.error, null)
    return client
  }
  const upload = async (bytes: Buffer, mime: string) => {
    const result = await fetch(`http://127.0.0.1:${server.port}/blobs`, { method: 'POST', headers: { authorization: `Bearer ${config.token}`, 'content-type': mime }, body: new Uint8Array(bytes) })
    assert.equal(result.status, 200)
    return blobInfoSchema.parse(await result.json())
  }
  const image = await upload(Buffer.from(data, 'base64'), 'image/png')
  const file = await upload(Buffer.from('TEXT_FROM_UPLOADED_FILE'), 'text/plain')
  read.blobId = file.id
  const socket = await connect()
  const created = await rpc(socket, 'session.create', { title: 'Attachments' })
  const sessionId = (created.result as { id: string }).id
  assert.ok((await rpc(socket, 'turn.start', { sessionId, text: '  ', attachments: [] })).error)
  assert.ok((await rpc(socket, 'turn.start', { sessionId, text: '', attachments: [{ blobId: randomUUID(), mime: 'text/plain' }] })).error)
  const params = { sessionId, text: '', idempotencyKey: 'files-only', attachments: [
    { blobId: image.id, mime: image.mime, filename: 'pixel.png' }, { blobId: file.id, mime: file.mime, filename: 'note.txt' },
  ] }
  const accepted = await rpc(socket, 'turn.start', params)
  assert.equal(accepted.error, null)
  await server.sessions.waitForIdle(sessionId)
  const repeated = await rpc(socket, 'turn.start', params)
  assert.equal((repeated.result as { inputId: string }).inputId, (accepted.result as { inputId: string }).inputId)
  assert.equal(model.requests.length, 2)
  assert.ok(JSON.stringify(model.requests[0]).includes(data))
  assert.match(JSON.stringify(model.requests[1]), /TEXT_FROM_UPLOADED_FILE/)
  const before = await rpc(socket, 'message.list', { sessionId })
  assert.equal(before.error, null)
  assert.match(JSON.stringify(before.result), /pixel.png/)
  assert.match(JSON.stringify(before.result), /note.txt/)
  assert.ok(!JSON.stringify(before.result).includes(data))
  const events = await rpc(socket, 'event.list', { sessionId, limit: 1000 })
  assert.ok(!JSON.stringify(events).includes(data))
  socket.terminate(); await server.close(); server = await startServer(config)
  const restored = await connect()
  assert.deepEqual((await rpc(restored, 'message.list', { sessionId })).result, before.result)
})

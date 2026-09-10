import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { PassThrough } from 'node:stream'
import { McpHttpChannel } from '../src/mcp/http-channel.ts'
import { McpStdioChannel, McpRemoteError } from '../src/mcp/stdio-channel.ts'
import { mcpHttpMessages } from '../src/mcp/http-body.ts'

test('SSE preserves split CRLF and UTF-8, and rejects unfinished events', async () => {
  const bytes = Buffer.from('data: {"text":"中文"}\r\n\r\ndata: {"n":2}\n\n')
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
    controller.close()
  } })
  const values = []
  for await (const value of mcpHttpMessages(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))) values.push(value)
  assert.deepEqual(values, [{ text: '中文' }, { n: 2 }])
  await assert.rejects(async () => {
    for await (const _ of mcpHttpMessages(new Response('data: {}\n', { headers: { 'Content-Type': 'text/event-stream' } }))) { /* consume */ }
  }, /mid-event/)
})

test('stdio handles server ping, notifications, successful and rejected requests', async () => {
  const input = new PassThrough(), output = new PassThrough(), writes: string[] = [], notifications: unknown[] = []
  input.on('data', chunk => writes.push(String(chunk)))
  const channel = new McpStdioChannel(input, output, () => {}, (method, params) => notifications.push({ method, params }))
  try {
    const request = channel.request('tools/list', {}, new AbortController().signal)
    output.write(JSON.stringify({ jsonrpc: '2.0', id: 'server-ping', method: 'ping' }) + '\n')
    output.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: { revision: 2 } }) + '\n')
    output.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }) + '\n')
    assert.deepEqual(await request, { tools: [] })
    assert.deepEqual(JSON.parse(writes[1]!), { jsonrpc: '2.0', id: 'server-ping', result: {} })
    assert.equal(notifications.length, 1)
    const rejected = channel.request('tools/call', {}, new AbortController().signal)
    output.write(JSON.stringify({ jsonrpc: '2.0', id: 2, error: { code: -32001, message: 'denied' } }) + '\n')
    await assert.rejects(rejected, error => error instanceof McpRemoteError && error.code === -32001)
  } finally { channel.close(); input.destroy(); output.destroy() }
})

test('real HTTP MCP session handles server messages and rejects identity changes', async () => {
  const received: Record<string, unknown>[] = [], notifications: string[] = []
  let changed = false
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const value = JSON.parse(Buffer.concat(chunks).toString())
    received.push(value)
    if (!value.method) { response.writeHead(202).end(); return }
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('mcp-session-id', changed ? 'other-session' : 'test-session')
    if (value.method === 'initialize') response.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: value.id, result: { protocolVersion: '2025-06-18' } })}\n\n`)
    else response.end([
      { jsonrpc: '2.0', id: 'ping', method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/tools/list_changed' },
      { jsonrpc: '2.0', id: value.id, result: { tools: [] } },
    ].map(message => `data: ${JSON.stringify(message)}\n\n`).join(''))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const channel = new McpHttpChannel(`http://127.0.0.1:${address.port}`, () => {}, method => notifications.push(method))
  try {
    assert.deepEqual(await channel.request('initialize', {}, new AbortController().signal), { protocolVersion: '2025-06-18' })
    assert.deepEqual(await channel.request('tools/list', {}, new AbortController().signal), { tools: [] })
    assert.ok(received.some(value => value.id === 'ping' && 'result' in value))
    assert.deepEqual(notifications, ['notifications/tools/list_changed'])
    changed = true
    await assert.rejects(channel.request('tools/list', {}, new AbortController().signal), /not confirmed/)
    assert.equal(channel.closedSignal.aborted, true)
  } finally { channel.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

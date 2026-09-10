import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PassThrough } from 'node:stream'
import { runConnector, WorkerFrameReader, encodeWorkerFrame } from '../src/connector/index.ts'
import type { JsonValue } from '@eden/api'

test('worker framing preserves split UTF-8 and rejects zero, oversized and truncated frames', () => {
  const reader = new WorkerFrameReader(), values: JsonValue[] = [], frame = encodeWorkerFrame({ text: '你好' })
  for (const byte of frame) reader.push(Buffer.from([byte]), value => values.push(value))
  reader.end(); assert.deepEqual(values, [{ text: '你好' }])
  for (const length of [0, 8 * 1024 * 1024 + 1]) { const header = Buffer.alloc(4); header.writeUInt32BE(length); assert.throws(() => new WorkerFrameReader().push(header, () => {}), /length/) }
  const partial = new WorkerFrameReader(); partial.push(frame.subarray(0, 5), () => {}); assert.throws(() => partial.end(), /inside/)
})

test('SDK rejects wrong worker identity and undeclared calls without exposing private exception text', async () => {
  const input = new PassThrough(), output = new PassThrough(), values: JsonValue[] = [], reader = new WorkerFrameReader()
  output.on('data', chunk => reader.push(chunk, value => values.push(value)))
  let initialized = 0
  const task = runConnector({ id: 'expected', version: '1', events: [], queries: [], actions: [], initialize() { initialized++; throw new Error('secret-token') } }, input, output)
  const params = { protocolVersion: 1, connectorInstanceId: '00000000-0000-4000-8000-000000000001', connectorKey: 'wrong', packageVersion: '1', settings: {}, grantedPermissions: [], dataDirectory: '/data' }
  input.write(encodeWorkerFrame({ id: 1, method: 'initialize', params }))
  input.end(encodeWorkerFrame({ id: 2, method: 'initialize', params: { ...params, connectorKey: 'expected' } }))
  await task
  assert.equal(initialized, 1); assert.equal(values.length, 2)
  assert.ok(values.every(value => value && typeof value === 'object' && 'error' in value))
  assert.ok(!JSON.stringify(values).includes('secret-token'))
})

test('protocol shutdown acknowledges completion and closes the session exactly once', async () => {
  const input = new PassThrough(), output = new PassThrough(), values: JsonValue[] = [], reader = new WorkerFrameReader()
  output.on('data', chunk => reader.push(chunk, value => values.push(value)))
  let closed = 0
  const task = runConnector({ id: 'shutdown-fixture', version: '1', events: [], queries: [], actions: [],
    initialize: () => ({ health: () => ({ state: 'ready', initialized: true }), close() { closed++ } }) }, input, output)
  input.write(encodeWorkerFrame({ id: 1, method: 'initialize', params: { protocolVersion: 1, connectorInstanceId: '00000000-0000-4000-8000-000000000001',
    connectorKey: 'shutdown-fixture', packageVersion: '1', settings: {}, grantedPermissions: [], dataDirectory: '/data' } }))
  input.write(encodeWorkerFrame({ id: 2, method: 'shutdown', params: null }))
  await task
  assert.equal(closed, 1)
  assert.deepEqual(values.at(-1), { id: 2, result: { disconnected: true } })
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mcpResultImages } from '../src/modules/mcp/result-images.ts'
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')

test('MCP projects both inline and embedded resource images, ignoring other content', async () => {
  const signal = new AbortController().signal
  const images = await mcpResultImages({ content: [null, { type: 'text', text: 'hi' }, { mimeType: 'image/png', data: png }, { resource: { mimeType: 'image/png', blob: png } }] }, signal)
  assert.equal(images.length, 2)
  assert.deepEqual(images[0], { type: 'image', mimeType: 'image/png', data: png })
  assert.deepEqual(await mcpResultImages(null, signal), [])
  assert.equal((await mcpResultImages({ contents: [{ mimeType: 'image/png', blob: png }] }, signal)).length, 1)
})

test('MCP rejects invalid encodings, wrong signatures, excessive image count and cancellation', async () => {
  const signal = new AbortController().signal
  for (const data of ['not-base64', Buffer.from('wrong signature').toString('base64')]) {
    await assert.rejects(mcpResultImages({ content: [{ mimeType: 'image/png', data }] }, signal), /MCP image/)
  }
  await assert.rejects(mcpResultImages({ content: Array.from({ length: 9 }, () => ({ mimeType: 'image/png', data: png })) }, signal), /MCP image/)
  await assert.rejects(mcpResultImages({}, AbortSignal.abort()), /abort/i)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { attachmentMessage } from '../src/modules/attachments/index.ts'
import { eventPayload } from '../src/transport/rpc/event-payload.ts'

test('public attachment projection preserves message text, identity and file references without mutating the source', () => {
  const blobId = randomUUID()
  const metadata = { attachments: [{ blobId, mime: 'image/png', filename: 'pixel.png', sha256: 'a'.repeat(64), byteLength: 3, kind: 'image' }] }
  const original = { messageId: 'message-1', message: { role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image', data: 'YWJj', mimeType: 'image/png' }], timestamp: 123 } }
  const before = structuredClone(original)
  const projected = attachmentMessage(original, metadata)
  assert.deepEqual(original, before)
  assert.deepEqual(projected, { messageId: 'message-1', message: { role: 'user', content: [
    { type: 'text', text: 'Look' }, { type: 'attachment', ...metadata.attachments[0] },
  ], timestamp: 123 } })
  assert.deepEqual(attachmentMessage(original), original)
})

test('wire projection removes large inline image blocks and data URLs while preserving the exact internal audit', () => {
  const bytes = Buffer.alloc(3 * 1024 * 1024, 0xab)
  const data = bytes.toString('base64')
  const original = { payload: { messages: [{ content: [{ type: 'image', data, mimeType: 'image/png' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${data}` } }, { type: 'text', text: 'Keep this text' }] }] } }
  const wire = JSON.stringify(eventPayload(original))
  assert.ok(wire.length < 1024)
  assert.ok(!wire.includes(data))
  assert.match(wire, new RegExp(createHash('sha256').update(bytes).digest('hex')))
  assert.match(wire, /Keep this text/)
  assert.equal(original.payload.messages[0]?.content[0]?.data, data)
})

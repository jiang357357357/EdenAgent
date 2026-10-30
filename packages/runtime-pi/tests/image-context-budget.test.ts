import assert from 'node:assert/strict'
import test from 'node:test'
import { contextSize } from '../src/automatic-compaction.ts'

test('MCP image placeholders do not consume a second visual budget', () => {
  const image = { type: 'image', mimeType: 'image/jpeg', data: Buffer.from('encoded-image-content').toString('base64') }
  const projected = { ...image, data: '[图片已作为独立视觉输入发送]' }
  const actual = contextSize({ content: [image], details: { content: [projected] } })
  assert.ok(actual >= 8192 && actual < 9000)
  assert.ok(contextSize({ content: [projected] }) < 200)
  assert.ok(contextSize({ content: Array(8).fill(image) }) >= 8 * 8192)
})

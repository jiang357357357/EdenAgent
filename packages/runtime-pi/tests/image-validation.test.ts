import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimeImages } from '../src/images.ts'

test('allocation-free image validation keeps canonical base64 pad-bit rules', () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  for (const data of ['AAAA', '/w==', '//8=', Buffer.from('图片输入').toString('base64')])
    assert.equal(runtimeImages([{ type: 'image', mimeType: 'image/png', data }])[0]?.data, data)
  for (const char of alphabet) {
    for (const data of [`A${char}==`, `AA${char}=`]) {
      const canonical = Buffer.from(data, 'base64').toString('base64') === data
      const validate = () => runtimeImages([{ type: 'image', mimeType: 'image/png', data }])
      if (canonical) assert.doesNotThrow(validate); else assert.throws(validate, /Noncanonical/)
    }
  }
  for (const data of ['====', 'A===', 'AA A', 'AAAA\n', '图像=='])
    assert.throws(() => runtimeImages([{ type: 'image', mimeType: 'image/png', data }]), /Invalid/)
  for (const data of ['AAA\n', 'AA\r\n', 'A==\n'])
    assert.throws(() => runtimeImages([{ type: 'image', mimeType: 'image/png', data }]), /Invalid|Noncanonical/)
})

test('image byte budget still applies across all images without decoded buffers', () => {
  const data = 'A'.repeat(24 * 1024 * 1024)
  const image = { type: 'image' as const, mimeType: 'image/png' as const, data }
  assert.throws(() => runtimeImages([image, image]), /exceeds 32 MiB/)
})

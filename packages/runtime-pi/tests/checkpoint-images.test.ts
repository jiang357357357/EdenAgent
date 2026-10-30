import assert from 'node:assert/strict'
import test from 'node:test'
import { createRuntime, assertCheckpointImages, type RuntimeImage } from '../src/index.ts'
import { parseCheckpoint } from '../src/checkpoint-schema.ts'
import { assertRequestImages } from '../src/request-images.ts'
import { callbacks, recordedModel } from './recorded-model.ts'
import type { RuntimeCheckpoint } from '@eden/api'

const image: RuntimeImage = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }
const checkpoint = (data = image.data): RuntimeCheckpoint => ({ format: 'eden.pi-harness.v1', runtimeVersion: '0.82.0',
  sessionId: 'image-integrity', createdAt: new Date(0).toISOString(), entries: [
    { type: 'message', id: 'entry', parentId: null, timestamp: new Date(0).toISOString(), message: {
      role: 'user', timestamp: 0, content: [{ ...image, data }] } },
  ] })

test('restored checkpoints reject noncanonical image data before a model request', async t => {
  const model = await recordedModel([{ text: 'must not be called' }]); t.after(() => model.close())
  for (const data of ['bad[宿主标识已隐藏]data', 'Zh==', 'a===', '']) {
    assert.throws(() => createRuntime({ sessionId: 'image-integrity', model: model.config, systemPrompt: '', tools: [],
      checkpoint: checkpoint(data), callbacks: callbacks().handlers }), /历史图片数据损坏/)
  }
  assert.equal(model.requests.length, 0); assert.equal(parseCheckpoint(checkpoint(), 'image-integrity').length, 1)
})

test('retained compaction tails and custom content receive the same image integrity checks', () => {
  const base = checkpoint(), bad = { ...image, data: 'invalid!' }
  for (const entry of [{ type: 'custom_message', content: [bad] }, { type: 'compaction', retainedTail: [{ role: 'user', content: [bad] }] }])
    assert.throws(() => assertCheckpointImages({ ...base, entries: [entry] }), /历史图片数据损坏/)
})

test('provider payload validation catches inline image corruption without changing external URLs or text', () => {
  const payload = (url: string) => ({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }] })
  assert.doesNotThrow(() => assertRequestImages(payload(`data:image/png;base64,${image.data}`)))
  assert.doesNotThrow(() => assertRequestImages(payload('https://image.example/picture.png')))
  assert.throws(() => assertRequestImages(payload('data:image/png;base64,broken[宿主标识已隐藏]')), /图片数据损坏/)
})

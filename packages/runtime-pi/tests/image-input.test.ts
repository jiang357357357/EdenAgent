import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime, type RuntimeImage } from '../src/index.ts'
import { recordedModel, callbacks } from './recorded-model.ts'

const image: RuntimeImage = { type: 'image', mimeType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=' }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { resolve, promise }
}

test('image input reaches the actual provider payload, tool continuation and restored history', async () => {
  const model = await recordedModel([{ tool: 'noop', input: {} }, { text: 'A pixel' }, { text: 'Remembered image' }])
  const record = callbacks()
  try {
    const options = { sessionId: 'images', systemPrompt: '', model: model.config, callbacks: record.handlers,
      tools: [{ name: 'noop', revision: '1', description: 'No effect', parameters: { type: 'object' }, async execute() { return null } }] }
    const runtime = createRuntime(options)
    const caller = { ...image }
    const pending = runtime.prompt('Describe this image', [caller])
    caller.data = Buffer.from('changed after submission').toString('base64')
    await pending
    assert.equal(model.requests.length, 2)
    for (const request of model.requests) {
      assert.ok(JSON.stringify(request).includes(`data:image/png;base64,${image.data}`))
      assert.ok(!JSON.stringify(request).includes(caller.data))
    }
    const checkpoint = await runtime.snapshot()
    assert.ok(JSON.stringify(checkpoint).includes(image.data))
    const restored = createRuntime({ ...options, checkpoint })
    await restored.prompt('What was in the image?')
    assert.ok(JSON.stringify(model.requests[2]).includes(`data:image/png;base64,${image.data}`))
  } finally { await model.close() }
})

test('image checkpoint failure prevents provider transmission', async () => {
  const model = await recordedModel([{ text: 'Must not run' }])
  const record = callbacks()
  try {
    const runtime = createRuntime({ sessionId: 'image-failure', systemPrompt: '', model: model.config, tools: [],
      callbacks: { ...record.handlers, async checkpoint(snapshot) {
        if (JSON.stringify(snapshot).includes(image.data)) throw new Error('image disk failure')
      } } })
    await assert.rejects(runtime.prompt('Image', [image]))
    assert.equal(model.requests.length, 0)
  } finally { await model.close() }
})

test('invalid image data is rejected before any checkpoint or model request', async () => {
  const model = await recordedModel([{ text: 'Must not run' }])
  let checkpoints = 0
  const record = callbacks()
  try {
    const runtime = createRuntime({ sessionId: 'invalid-images', systemPrompt: '', model: model.config, tools: [],
      callbacks: { ...record.handlers, async checkpoint() { checkpoints++ } } })
    await assert.rejects(runtime.prompt('Image', [{ ...image, data: 'not base64!' }]), /base64/)
    await assert.rejects(runtime.prompt('Image', [{ ...image, data: 'AB==' }]), /Noncanonical/)
    await assert.rejects(runtime.prompt('Image', Array.from({ length: 9 }, () => image)), /eight/)
    assert.equal(checkpoints, 0)
    assert.equal(model.requests.length, 0)
  } finally { await model.close() }
})

for (const kind of ['steer', 'followUp'] as const) {
  test(`image ${kind} is durably consumed during a running tool loop`, async () => {
    const model = await recordedModel([{ tool: 'pause', input: {} }, { text: 'First answer' }, { text: 'Image answer' }])
    const record = callbacks()
    const entered = deferred()
    const release = deferred()
    try {
      const runtime = createRuntime({ sessionId: `image-${kind}`, systemPrompt: '', model: model.config, callbacks: record.handlers,
        tools: [{ name: 'pause', revision: '1', description: 'Wait', parameters: { type: 'object' }, async execute() {
          entered.resolve(); await release.promise; return null
        } }] })
      const active = runtime.prompt('Start the tool')
      await entered.promise
      await runtime[kind]('Inspect the image', [image])
      release.resolve()
      await active
      assert.ok(JSON.stringify(model.requests.at(-1)).includes(`data:image/png;base64,${image.data}`))
      assert.ok(JSON.stringify(await runtime.snapshot()).includes(image.data))
    } finally { release.resolve(); await model.close() }
  })
}

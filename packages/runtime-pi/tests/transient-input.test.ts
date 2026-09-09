import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRuntime } from '../src/index.ts'
import { recordedModel, callbacks } from './recorded-model.ts'

const instruction = 'PRIVATE_HANDOFF_INSTRUCTION: greet as the new assistant'

test('transient input is available throughout its tool loop, audited as custom data, and omitted from restored history', async () => {
  const model = await recordedModel([{ tool: 'noop', input: {} }, { text: 'New assistant greeting' }, { text: 'Next reply' }, { text: 'Same runtime reply' }])
  const record = callbacks()
  try {
    const options = { sessionId: 'transient', systemPrompt: 'Follow the conversation.', model: model.config, callbacks: record.handlers,
      tools: [{ name: 'noop', revision: '1', description: 'No effect', parameters: { type: 'object' }, async execute() { return null } }] }
    const runtime = createRuntime({ ...options, transientInput: true })
    await runtime.prompt(instruction)
    assert.equal(model.requests.length, 2)
    assert.match(JSON.stringify(model.requests[0]), /PRIVATE_HANDOFF_INSTRUCTION/)
    assert.match(JSON.stringify(model.requests[1]), /PRIVATE_HANDOFF_INSTRUCTION/)
    const checkpoint = await runtime.snapshot()
    assert.match(JSON.stringify(checkpoint), /eden.transient_input/)
    assert.match(JSON.stringify(checkpoint), /PRIVATE_HANDOFF_INSTRUCTION/)
    assert.equal(checkpoint.entries.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry) && entry.type === 'custom').length, 1)
    const restored = createRuntime({ ...options, checkpoint })
    await restored.prompt('A real user question')
    assert.doesNotMatch(JSON.stringify(model.requests[2]), /PRIVATE_HANDOFF_INSTRUCTION/)
    assert.match(JSON.stringify(model.requests[2]), /New assistant greeting/)
    assert.match(JSON.stringify(model.requests[2]), /A real user question/)
    assert.match(JSON.stringify(await restored.snapshot()), /A real user question/)
    await runtime.prompt('Another actual user question')
    assert.doesNotMatch(JSON.stringify(model.requests[3]), /PRIVATE_HANDOFF_INSTRUCTION/)
    assert.match(JSON.stringify(model.requests[3]), /Another actual user question/)
  } finally { await model.close() }
})

test('transient audit persistence failure prevents the model request', async () => {
  const model = await recordedModel([{ text: 'Must not run' }])
  const record = callbacks()
  try {
    const runtime = createRuntime({ sessionId: 'transient-failure', systemPrompt: '', model: model.config, tools: [], transientInput: true,
      callbacks: { ...record.handlers, async checkpoint(snapshot) {
        if (JSON.stringify(snapshot).includes('eden.transient_input')) throw new Error('transient audit disk failure')
      } } })
    await assert.rejects(runtime.prompt(instruction))
    assert.equal(model.requests.length, 0)
  } finally { await model.close() }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../src/index.ts'
import { callbacks, recordedModel } from './recorded-model.ts'

test('near-limit restored conversation compacts before the next request and preserves current input', async () => {
  const model = await recordedModel([{ text: 'A'.repeat(11000) }, { text: 'SUMMARY: old work complete' }, { text: 'Continued' }, { text: 'Restored' }])
  const record = callbacks()
  const config = { ...model.config, contextWindow: 10000 }
  try {
    const runtime = createRuntime({ sessionId: 'automatic', systemPrompt: '', model: config, tools: [], callbacks: record.handlers })
    await runtime.prompt('OLD '.repeat(1750))
    const restored = createRuntime({ sessionId: 'automatic', systemPrompt: '', model: config, tools: [], callbacks: record.handlers, checkpoint: await runtime.snapshot() })
    await restored.prompt('CURRENT '.repeat(1000))
    assert.equal(model.requests.length, 3)
    assert.match(JSON.stringify(model.requests[1]), /OLD/)
    assert.match(JSON.stringify(model.requests[2]), /SUMMARY: old work complete/)
    assert.match(JSON.stringify(model.requests[2]), /CURRENT/)
    assert.doesNotMatch(JSON.stringify(model.requests[2]), /A{1000}/)
    const checkpoint = await restored.snapshot()
    assert.ok(checkpoint.entries.some(e => e && typeof e === 'object' && !Array.isArray(e) && e.type === 'compaction'))
    const again = createRuntime({ sessionId: 'automatic', systemPrompt: '', model: config, tools: [], callbacks: record.handlers, checkpoint })
    await again.prompt('Next')
    assert.match(JSON.stringify(model.requests[3]), /SUMMARY: old work complete/)
  } finally { await model.close() }
})

test('tool results trigger compaction without replaying the tool', async () => {
  const model = await recordedModel([{ tool: 'lookup', input: {} }, ...Array.from({ length: 8 }, () => ({ text: 'SUMMARY: lookup finished successfully' }))])
  let calls = 0
  try {
    const runtime = createRuntime({ sessionId: 'automatic-tool', systemPrompt: 'S'.repeat(6000), model: { ...model.config, contextWindow: 10000 }, callbacks: callbacks().handlers,
      tools: [{ name: 'lookup', revision: '1', description: 'lookup', parameters: { type: 'object' }, async execute() { calls++; return 'R'.repeat(19000) } }] })
    await runtime.prompt('Look up the data')
    assert.equal(calls, 1)
    assert.ok(model.requests.length >= 3)
    assert.match(JSON.stringify(model.requests.at(-1)), /lookup finished successfully/)
    assert.doesNotMatch(JSON.stringify(model.requests.at(-1)), /R{1000}/)
  } finally { await model.close() }
})

test('uncompressible system overhead blocks request rather than looping or deleting history', async () => {
  const model = await recordedModel([{ text: 'Should not run' }])
  try {
    const runtime = createRuntime({ sessionId: 'fixed-too-large', systemPrompt: 'S'.repeat(30000), model: { ...model.config, contextWindow: 10000 }, tools: [], callbacks: callbacks().handlers })
    const result = await runtime.prompt('hello') as { stopReason?: string; errorMessage?: string }
    assert.equal(result.stopReason, 'error')
    assert.match(result.errorMessage ?? '', /系统提示/)
    assert.equal(model.requests.length, 0)
    assert.ok(!(await runtime.snapshot()).entries.some(e => e && typeof e === 'object' && !Array.isArray(e) && e.type === 'compaction'))
  } finally { await model.close() }
})

test('failed automatic compaction checkpoint prevents continuation and keeps original durable history', async () => {
  const model = await recordedModel([{ text: 'A'.repeat(11000) }, { text: 'SUMMARY' }, { text: 'Must not run' }])
  const record = callbacks()
  let compacting = false
  try {
    const runtime = createRuntime({ sessionId: 'auto-checkpoint-failure', systemPrompt: '', model: { ...model.config, contextWindow: 10000 }, tools: [],
      callbacks: { ...record.handlers, async checkpoint(snapshot) {
        if (compacting && snapshot.entries.some(e => e && typeof e === 'object' && !Array.isArray(e) && e.type === 'compaction')) throw new Error('Checkpoint rejected')
        await record.handlers.checkpoint(snapshot)
      } } })
    await runtime.prompt('OLD '.repeat(1750))
    compacting = true
    await assert.rejects(runtime.prompt('CURRENT '.repeat(1000)))
    assert.equal(model.requests.length, 2)
    assert.ok(!(await runtime.snapshot()).entries.some(e => e && typeof e === 'object' && !Array.isArray(e) && e.type === 'compaction'))
  } finally { await model.close() }
})

test('transient handoff input is budgeted but never folded into durable summaries', async () => {
  const model = await recordedModel([{ text: 'A'.repeat(11000) }, { text: 'SUMMARY: work complete' }, { text: 'Handoff done' }])
  const config = { ...model.config, contextWindow: 10000 }
  try {
    const initial = createRuntime({ sessionId: 'auto-transient', systemPrompt: '', model: config, tools: [], callbacks: callbacks().handlers })
    await initial.prompt('OLD '.repeat(1750))
    const runtime = createRuntime({ sessionId: 'auto-transient', systemPrompt: '', model: config, tools: [], transientInput: true, callbacks: callbacks().handlers, checkpoint: await initial.snapshot() })
    await runtime.prompt('PRIVATE_HANDOFF '.repeat(550))
    assert.equal(model.requests.length, 3)
    assert.doesNotMatch(JSON.stringify(model.requests[1]), /PRIVATE_HANDOFF/)
    assert.match(JSON.stringify(model.requests[2]), /PRIVATE_HANDOFF/)
    const compactions = (await runtime.snapshot()).entries.filter(e => e && typeof e === 'object' && !Array.isArray(e) && e.type === 'compaction')
    assert.equal(compactions.length, 1)
    assert.doesNotMatch(JSON.stringify(compactions), /PRIVATE_HANDOFF/)
  } finally { await model.close() }
})

test('cancelling automatic summary preserves history and sends no continuation request', async () => {
  const model = await recordedModel([{ text: 'A'.repeat(11000) }, { wait: true }])
  try {
    const runtime = createRuntime({ sessionId: 'auto-cancel', systemPrompt: '', model: { ...model.config, contextWindow: 10000 }, tools: [], callbacks: callbacks().handlers })
    await runtime.prompt('OLD '.repeat(1750))
    const running = runtime.prompt('CURRENT '.repeat(1000)).catch(() => undefined)
    for (let i = 0; i < 100 && model.requests.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(model.requests.length, 2)
    await runtime.abort()
    await running
    assert.equal(model.requests.length, 2)
    assert.ok(!(await runtime.snapshot()).entries.some(e => e && typeof e === 'object' && !Array.isArray(e) && e.type === 'compaction'))
  } finally { await model.close() }
})

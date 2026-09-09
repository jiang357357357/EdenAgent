import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createRuntime } from '../src/index.ts'
import { recordedModel, callbacks } from './recorded-model.ts'

test('compaction request persistence failure prevents its HTTP request', async () => {
  const model = await recordedModel([{ text: 'Long answer '.repeat(500) }, { text: 'Must not be requested' }])
  const record = callbacks()
  let requests = 0
  try {
    const runtime = createRuntime({ sessionId: 'compact-write-failure', systemPrompt: '', model: model.config, tools: [],
      callbacks: { ...record.handlers, async request(snapshot) {
        if (++requests === 2) throw new Error('Compaction request storage failed')
        await record.handlers.request(snapshot)
      } } })
    await runtime.prompt('Context '.repeat(500))
    await assert.rejects(runtime.compact('Summarize'))
    assert.equal(model.requests.length, 1)
    await assert.rejects(runtime.prompt('Do not continue'), /persistence/)
  } finally { await model.close() }
})

test('cancellation terminates a waiting compaction request and preserves prior history', async () => {
  const model = await recordedModel([{ text: 'Long answer '.repeat(500) }, { wait: true }])
  const record = callbacks()
  try {
    const runtime = createRuntime({ sessionId: 'compact-abort', systemPrompt: '', model: model.config, tools: [], callbacks: record.handlers })
    await runtime.prompt('Context '.repeat(500))
    const compacting = runtime.compact('Summarize')
    const rejected = assert.rejects(compacting)
    for (let attempt = 0; attempt < 200 && model.requests.length < 2; attempt++) await delay(5)
    assert.equal(model.requests.length, 2)
    await runtime.abort()
    await rejected
    assert.equal(record.requests.length, 2)
    assert.ok(!(await runtime.snapshot()).entries.some(entry => typeof entry === 'object' && entry !== null && !Array.isArray(entry) && entry.type === 'compaction'))
  } finally { await model.close() }
})

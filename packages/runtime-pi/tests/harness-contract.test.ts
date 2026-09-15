import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { createRuntime } from '../src/index.ts'
import type { RuntimeTool } from '../src/index.ts'
import { recordedModel, callbacks } from './recorded-model.ts'

test('public harness streams, executes tools, snapshots, and restores model history', async () => {
  const model = await recordedModel([{ tool: 'count', input: { value: 3 } }, { text: 'Counted 3' }, { text: 'Remembered' }])
  const record = callbacks()
  let executions = 0
  const tool: RuntimeTool = {
    name: 'count', revision: 'test-v1', description: 'Return a number',
    parameters: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false },
    async execute(input) { executions++; return { count: Number(input.value) } },
  }
  try {
    const options = { sessionId: 'p0-session', systemPrompt: 'Use tools when asked.', model: model.config, tools: [tool], callbacks: record.handlers }
    const runtime = createRuntime(options)
    const answer = await runtime.prompt('Count 3')
    assert.match(JSON.stringify(answer), /Counted 3/)
    assert.equal(executions, 1)
    assert.equal(record.requests.length, 2)
    assert.ok(record.events.some(event => event.kind === 'message_update'))
    const checkpoint = await runtime.snapshot()
    assert.deepEqual(record.checkpoints.at(-1), checkpoint)
    const restored = createRuntime({ ...options, checkpoint })
    await restored.prompt('What was the count?')
    assert.match(JSON.stringify(model.requests[2]), /Counted 3/)
    assert.match(JSON.stringify(model.requests[2]), /tool_call_id/)
    assert.equal(executions, 1)
  } finally { await model.close() }
})

test('checkpoint failure blocks tool execution and poisons the runtime', async () => {
  const model = await recordedModel([{ tool: 'effect', input: {} }])
  const record = callbacks()
  let executed = false
  try {
    const runtime = createRuntime({
      sessionId: 'failure-session', systemPrompt: '', model: model.config,
      tools: [{ name: 'effect', revision: '1', description: 'effect', parameters: { type: 'object', properties: {} },
        async execute() { executed = true; return null } }],
      callbacks: { ...record.handlers, async checkpoint(snapshot) {
        if (JSON.stringify(snapshot).includes('toolCall')) throw new Error('simulated disk full')
        await record.handlers.checkpoint(snapshot)
      } },
    })
    await assert.rejects(runtime.prompt('Execute effect'))
    assert.equal(executed, false)
    await assert.rejects(runtime.prompt('Try again'))
    assert.equal(model.requests.length, 1)
  } finally { await model.close() }
})

test('cancel stops a waiting model stream and settles the run', async () => {
  const model = await recordedModel([{ wait: true }])
  try {
    const runtime = createRuntime({ sessionId: 'cancel-session', systemPrompt: '', model: model.config, tools: [], callbacks: callbacks().handlers })
    const running = runtime.prompt('Wait')
    for (let attempt = 0; !model.requests.length && attempt < 100; attempt++) await setTimeout(10)
    assert.equal(model.requests.length, 1)
    await runtime.abort()
    await running
    await runtime.waitForIdle()
  } finally { await model.close() }
})

test('rejects mismatched checkpoint ownership and malformed persisted entries', async () => {
  const model = await recordedModel([])
  try {
    const options = { sessionId: 'one', systemPrompt: '', model: model.config, tools: [], callbacks: callbacks().handlers }
    const checkpoint = await createRuntime(options).snapshot()
    assert.throws(() => createRuntime({ ...options, sessionId: 'two', checkpoint }), /mismatch/)
    assert.throws(() => createRuntime({ ...options, checkpoint: { ...checkpoint, entries: [{ type: 'message' }] } }))
  } finally { await model.close() }
})

test('context source metadata is audited without changing the provider prompt', async () => {
  const model = await recordedModel([{ text: 'ok' }]), record = callbacks()
  const sources = [{ kind: 'system', title: 'Rules', content: 'exact system' }]
  try {
    const runtime = createRuntime({ sessionId: 'sources', systemPrompt: 'exact system', contextSources: sources,
      model: model.config, tools: [], callbacks: record.handlers })
    await runtime.prompt('hello')
    const audit = record.requests[0] as Record<string, unknown>
    assert.deepEqual(audit.contextSources, sources)
    assert.equal(JSON.stringify(model.requests[0]).includes('contextSources'), false)
    assert.ok(JSON.stringify(model.requests[0]).includes('exact system'))
  } finally { await model.close() }
})

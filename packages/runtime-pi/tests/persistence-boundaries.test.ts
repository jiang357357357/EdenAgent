import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRuntime } from '../src/index.ts'
import { DurableSessionStorage } from '../src/durable-session.ts'
import { recordedModel, callbacks } from './recorded-model.ts'

test('event persistence failure blocks the following external operation', async () => {
  const model = await recordedModel([{ tool: 'effect', input: {} }])
  const record = callbacks()
  let executed = false
  try {
    const runtime = createRuntime({
      sessionId: 'event-failure', systemPrompt: '', model: model.config,
      tools: [{ name: 'effect', revision: '1', description: 'effect', parameters: { type: 'object' },
        async execute() { executed = true; return null } }],
      callbacks: { ...record.handlers, async event(kind, value) {
        if (kind === 'message_end' && JSON.stringify(value).includes('toolCall')) throw new Error('event write failed')
        await record.handlers.event(kind, value)
      } },
    })
    await assert.rejects(runtime.prompt('Execute'))
    assert.equal(executed, false)
  } finally { await model.close() }
})

test('operation-intent failure cannot become an ordinary retryable tool error', async () => {
  const model = await recordedModel([{ tool: 'effect', input: {} }, { tool: 'effect', input: {} }])
  let executed = false
  try {
    const runtime = createRuntime({
      sessionId: 'operation-failure', systemPrompt: '', model: model.config,
      tools: [{ name: 'effect', revision: '1', description: 'effect', parameters: { type: 'object' },
        async execute() { executed = true; return null } }],
      callbacks: { ...callbacks().handlers, async beforeTool() { throw new Error('intent write failed') } },
    })
    await assert.rejects(runtime.prompt('Execute'))
    assert.equal(executed, false)
    assert.equal(model.requests.length, 1)
  } finally { await model.close() }
})

test('a request cannot reach the provider when request capture fails', async () => {
  const model = await recordedModel([{ text: 'Must not happen' }])
  try {
    const runtime = createRuntime({ sessionId: 'request-failure', systemPrompt: '', model: model.config, tools: [],
      callbacks: { ...callbacks().handlers, async request() { throw new Error('request capture failed') } } })
    await assert.rejects(runtime.prompt('Go'))
    assert.equal(model.requests.length, 0)
  } finally { await model.close() }
})

test('compaction and branch leaf survive checkpoint restoration through public storage', async () => {
  const record = callbacks()
  const storage = new DurableSessionStorage('tree', record.handlers.checkpoint)
  const session = storage.session()
  const first = await session.appendMessage({ role: 'user', content: 'Old context', timestamp: 1 })
  const second = await session.appendMessage({ role: 'user', content: 'Retained context', timestamp: 2 })
  await session.appendCompaction('Summary of old context', second, 100)
  let restored = new DurableSessionStorage('tree', record.handlers.checkpoint, await storage.snapshot())
  assert.match(JSON.stringify(await restored.session().buildContext()), /Summary of old context/)
  await restored.session().moveTo(first)
  restored = new DurableSessionStorage('tree', record.handlers.checkpoint, await restored.snapshot())
  assert.equal(await restored.getLeafId(), first)
  assert.doesNotMatch(JSON.stringify(await restored.session().buildContext()), /Retained context/)
})

test('follow-up injected while executing a tool becomes another model request', async () => {
  const model = await recordedModel([{ tool: 'wait', input: {} }, { text: 'Tool finished' }, { text: 'Follow-up handled' }])
  let unblock!: () => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const blocked = new Promise<void>(resolve => { unblock = resolve })
  try {
    const runtime = createRuntime({ sessionId: 'follow-up', systemPrompt: '', model: model.config,
      tools: [{ name: 'wait', description: 'Wait for test', revision: '1', parameters: { type: 'object' },
        async execute() { entered(); await blocked; return null } }], callbacks: callbacks().handlers })
    const running = runtime.prompt('First')
    await started
    await runtime.followUp('Then answer this follow-up')
    unblock()
    await running
    assert.equal(model.requests.length, 3)
    assert.match(JSON.stringify(model.requests[2]), /Then answer this follow-up/)
  } finally { unblock?.(); await model.close() }
})

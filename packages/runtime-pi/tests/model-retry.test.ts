import assert from 'node:assert/strict'
import test from 'node:test'
import { createRuntime, defaultModelRetryPolicy, modelRetryDelay } from '../src/index.ts'
import { callbacks, recordedModel } from './recorded-model.ts'

test('default retry backoff waits 500ms and then 1500ms', () => {
  assert.equal(modelRetryDelay(defaultModelRetryPolicy, 1), 500)
  assert.equal(modelRetryDelay(defaultModelRetryPolicy, 2), 1_500)
})

test('a terminated stream rewinds its failed branch and retries the same logical turn', async () => {
  const fixture = await recordedModel([{ error: 'terminated', partial: 'HALF_REPLY' }, { text: '完整回复' }, { text: '继续完成' }])
  const record = callbacks()
  try {
    const runtime = createRuntime({ sessionId: 'retry-stream', systemPrompt: '', model: fixture.config, tools: [], callbacks: record.handlers,
      modelRetry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 } })
    const result = await runtime.prompt('原始问题') as Record<string, unknown>
    assert.equal(result.stopReason, 'stop')
    assert.equal(fixture.requests.length, 2)
    assert.equal(record.events.filter(event => event.kind === 'retry_scheduled').length, 1)
    assert.equal(record.events.filter(event => event.kind === 'retry_attempt_start').length, 1)
    assert.equal(record.events.filter(event => event.kind === 'retry_finished').length, 1)
    assert.equal(record.events.filter(event => event.kind === 'message_end' && JSON.stringify(event.payload).includes('"role":"user"')).length, 1)

    const checkpoint = record.checkpoints.at(-1)
    assert.ok(checkpoint)
    const restored = createRuntime({ sessionId: 'retry-stream', systemPrompt: '', model: fixture.config, tools: [], callbacks: record.handlers,
      checkpoint, modelRetry: { maxRetries: 0 } })
    await restored.prompt('继续')
    const resumedRequest = JSON.stringify(fixture.requests.at(-1))
    assert.doesNotMatch(resumedRequest, /HALF_REPLY/)
    assert.match(resumedRequest, /完整回复/)
    assert.equal(resumedRequest.match(/原始问题/g)?.length, 1)
  } finally { await fixture.close() }
})

test('only the failed model request is retried after a tool, without replaying the tool', async () => {
  const fixture = await recordedModel([{ tool: 'effect', input: {} }, { error: 'terminated' }, { text: '恢复完成' }])
  const record = callbacks()
  let executions = 0
  try {
    const runtime = createRuntime({ sessionId: 'retry-tool-boundary', systemPrompt: '', model: fixture.config,
      tools: [{ name: 'effect', revision: '1', description: 'effect', parameters: { type: 'object' }, async execute() { executions++; return null } }],
      callbacks: record.handlers, modelRetry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 } })
    const result = await runtime.prompt('执行') as Record<string, unknown>
    assert.equal(result.stopReason, 'stop')
    assert.equal(executions, 1)
    assert.equal(fixture.requests.length, 3)
    assert.deepEqual(fixture.requests[1], fixture.requests[2])
    assert.match(JSON.stringify(record.events.filter(event => event.kind === 'model_transport')), /UND_ERR_SOCKET|ECONNRESET/)
    assert.equal(record.events.filter(event => event.kind === 'retry_scheduled').length, 0)
  } finally { await fixture.close() }
})

test('non-transient model errors are not retried', async () => {
  const fixture = await recordedModel([{ status: 429, error: 'insufficient_quota' }, { text: '不得请求' }])
  try {
    const runtime = createRuntime({ sessionId: 'retry-quota', systemPrompt: '', model: fixture.config, tools: [], callbacks: callbacks().handlers,
      modelRetry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 } })
    const result = await runtime.prompt('执行') as Record<string, unknown>
    assert.equal(result.stopReason, 'error')
    assert.equal(fixture.requests.length, 1)
  } finally { await fixture.close() }
})

test('transient provider status failures are retried', async () => {
  const fixture = await recordedModel([{ status: 503, error: 'service unavailable' }, { text: '恢复完成' }])
  const record = callbacks()
  try {
    const runtime = createRuntime({ sessionId: 'retry-status', systemPrompt: '', model: fixture.config, tools: [], callbacks: record.handlers,
      modelRetry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 } })
    const result = await runtime.prompt('执行') as Record<string, unknown>
    assert.equal(result.stopReason, 'stop')
    assert.equal(fixture.requests.length, 2)
    assert.equal(record.events.filter(event => event.kind === 'model_request_retry').length, 1)
  } finally { await fixture.close() }
})

test('aborting during retry backoff prevents another provider request', async () => {
  const fixture = await recordedModel([{ error: 'terminated' }, { text: '不得请求' }])
  const record = callbacks()
  let runtime: ReturnType<typeof createRuntime>
  const handlers = {
    ...record.handlers,
    async event(kind: string, payload: Parameters<typeof record.handlers.event>[1]) {
      await record.handlers.event(kind, payload)
      if (kind === 'model_request_retry') setTimeout(() => void runtime.abort(), 0)
    },
  }
  try {
    runtime = createRuntime({ sessionId: 'retry-abort', systemPrompt: '', model: fixture.config, tools: [], callbacks: handlers,
      modelRetry: { maxRetries: 2, baseDelayMs: 10_000, maxDelayMs: 10_000 } })
    const result = await runtime.prompt('执行') as Record<string, unknown>
    assert.equal(result.stopReason, 'aborted')
    assert.equal(fixture.requests.length, 1)
  } finally { await fixture.close() }
})


test('request retry exhaustion stops at three attempts without a second turn-level budget', async () => {
  const fixture = await recordedModel(Array.from({ length: 4 }, () => ({ status: 503, error: 'service unavailable' })))
  try {
    const record = callbacks()
    const runtime = createRuntime({ sessionId: 'retry-exhausted', systemPrompt: '', model: fixture.config, tools: [], callbacks: record.handlers,
      modelRetry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 } })
    const result = await runtime.prompt('执行') as Record<string, unknown>
    assert.equal(result.stopReason, 'error')
    assert.equal(fixture.requests.length, 3)
    assert.equal(record.events.filter(event => event.kind === 'retry_scheduled').length, 0)
    assert.match(JSON.stringify(record.events.filter(event => event.kind === 'model_transport')), /"status":503/)
  } finally { await fixture.close() }
})

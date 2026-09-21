import test from 'node:test'
import assert from 'node:assert/strict'
import { safeTransportError } from '../src/model-transport-diagnostics.ts'
import { createRuntime } from '../src/index.ts'
import { recordedModel, callbacks } from './recorded-model.ts'

test('transport cause chains preserve codes and redact credentials, URLs and arbitrary properties', () => {
  const cause = Object.assign(new Error('connect https://user:pass@example.com/v1?token=secret-key Bearer auth-key'), { code: 'ECONNRESET', syscall: 'connect', headers: { authorization: 'private' } })
  const error = new Error('fetch failed secret-key', { cause: new AggregateError([cause], 'network') })
  const result = JSON.stringify(safeTransportError(error, ['secret-key']))
  assert.match(result, /ECONNRESET/)
  assert.match(result, /fetch failed/)
  assert.doesNotMatch(result, /secret-key|auth-key|user:pass|token=|headers|private/)
})

test('partial model output after a side effect is not automatically replayed', async () => {
  const fixture = await recordedModel([{ tool: 'effect', input: {} }, { error: 'terminated', partial: 'visible text' }, { text: 'not reached' }])
  let calls = 0
  try {
    const runtime = createRuntime({ sessionId: 'partial-after-tool', systemPrompt: '', model: fixture.config,
      tools: [{ name: 'effect', revision: '1', description: 'effect', parameters: { type: 'object' }, async execute() { calls++; return null } }], callbacks: callbacks().handlers })
    const result = await runtime.prompt('go') as Record<string, unknown>
    assert.equal(result.stopReason, 'error'); assert.equal(calls, 1); assert.equal(fixture.requests.length, 2)
  } finally { await fixture.close() }
})

test('a failed diagnostic write stops execution and cannot be treated as a network retry', async () => {
  const fixture = await recordedModel([{ tool: 'effect', input: {} }])
  let calls = 0
  try {
    const runtime = createRuntime({ sessionId: 'diagnostic-failure', systemPrompt: '', model: fixture.config,
      tools: [{ name: 'effect', revision: '1', description: 'effect', parameters: { type: 'object' }, async execute() { calls++; return null } }],
      callbacks: { ...callbacks().handlers, async event(kind) { if (kind === 'model_transport') throw new Error('disk full') } } })
    await assert.rejects(runtime.prompt('go'))
    assert.equal(calls, 0); assert.equal(fixture.requests.length, 1)
  } finally { await fixture.close() }
})

test('connection refusal retains the nested OS error for every bounded attempt', async () => {
  const fixture = await recordedModel([])
  await fixture.close()
  const record = callbacks()
  const runtime = createRuntime({ sessionId: 'connection-refused', systemPrompt: '', model: fixture.config, tools: [], callbacks: record.handlers,
    modelRetry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 } })
  const result = await runtime.prompt('go') as Record<string, unknown>
  assert.equal(result.stopReason, 'error')
  const failures = record.events.filter(event => event.kind === 'model_transport')
  assert.equal(failures.length, 3)
  for (const failure of failures) assert.match(JSON.stringify(failure.payload), /ECONNREFUSED/)
})

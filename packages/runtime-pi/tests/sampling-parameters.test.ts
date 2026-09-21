import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../src/index.ts'
import { recordedModel, callbacks } from './recorded-model.ts'
import { samplingPayload } from '../src/sampling-parameters.ts'
import { configuredModelSchema } from '@eden/api'

const sampling = { temperature: 0.8, topP: 0.8, presencePenalty: 0.4, frequencyPenalty: 0.2 }

test('explicit sampling reaches actual provider request and audit', async () => {
  const f = await recordedModel([{ text: 'done' }])
  try {
    const audit = callbacks()
    await createRuntime({ sessionId: 'sampling', model: { ...f.config, sampling }, systemPrompt: '', tools: [], callbacks: audit.handlers }).prompt('hello')
    const request = f.requests[0]!
    for (const [key, expected] of Object.entries({ temperature: 0.8, top_p: 0.8, presence_penalty: 0.4, frequency_penalty: 0.2 })) assert.equal(request[key], expected)
    const saved = audit.requests[0] as { payload: Record<string, unknown> }
    assert.equal(saved.payload.temperature, request.temperature)
  } finally { await f.close() }
})

test('DeepSeek thinking maps medium to high and omits unsupported sampling', async () => {
  const f = await recordedModel([{ text: 'done', thinking: 'fixture' }])
  try {
    await createRuntime({ sessionId: 'thinking', model: { ...f.config, provider: 'deepseek', reasoning: 'medium', sampling }, systemPrompt: '', tools: [], callbacks: callbacks().handlers }).prompt('hello')
    const request = f.requests[0]!
    assert.deepEqual(request.thinking, { type: 'enabled' })
    assert.equal(request.reasoning_effort, 'high')
    assert.equal(request.top_p, 0.95)
    assert.equal('temperature' in request, false)
    assert.equal('presence_penalty' in request, false)
    assert.equal('frequency_penalty' in request, false)
  } finally { await f.close() }
})

test('DeepSeek off is explicit on wire and enables temperature, not top_p', async () => {
  const f = await recordedModel([{ text: 'done' }])
  try {
    await createRuntime({ sessionId: 'off', model: { ...f.config, provider: 'deepseek', reasoning: 'off', sampling }, systemPrompt: '', tools: [], callbacks: callbacks().handlers }).prompt('hello')
    const request = f.requests[0]!
    assert.deepEqual(request.thinking, { type: 'disabled' })
    assert.equal(request.temperature, 0.8)
    assert.equal('top_p' in request, false)
  } finally { await f.close() }
})

test('unset defaults stay absent, per-call settings win and invalid values fail validation', () => {
  const model = { provider: 'test', id: 'test', baseUrl: 'http://localhost:1234', contextWindow: 32000, maxTokens: 1024 }
  assert.deepEqual(samplingPayload({ model: 'test' }, model), { model: 'test' })
  assert.equal((samplingPayload({ temperature: 0 }, { ...model, sampling }) as any).temperature, 0)
  assert.throws(() => configuredModelSchema.parse({ ...model, sampling: { temperature: 3 } }))
  assert.throws(() => configuredModelSchema.parse({ ...model, sampling: { apiKey: 'untrusted' } }))
})

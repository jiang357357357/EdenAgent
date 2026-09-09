import test from 'node:test'
import assert from 'node:assert/strict'
import { recordedModel } from '@eden/runtime-pi/testing'
import { extractMemoryCandidates, parseMemoryCandidates } from '../src/modules/memories/index.ts'
import type { JsonValue } from '@eden/api'
import { setTimeout as delay } from 'node:timers/promises'

test('memory extraction accepts fenced JSON, filters unsafe candidates and deduplicates normalized content', () => {
  const result = parseMemoryCandidates('```json\n' + JSON.stringify({ memories: [
    { kind: 'preference', content: '  User\n prefers tea  ', confidence: 0.95 },
    { kind: 'fact', content: 'user prefers tea', confidence: 0.99 },
    { kind: 'fact', content: 'Maybe a preference', confidence: 0.84 },
    { kind: 'fact', content: 'token: private-value', confidence: 0.99 },
    { kind: 'unknown', content: 'Unsupported type', confidence: 1 },
    { kind: 'fact', content: '字'.repeat(4001), confidence: 0.99 },
    { kind: 'fact', content: '   ', confidence: 1 },
    { kind: 'fact', content: 'Invalid confidence', confidence: 2 },
  ] }) + '\n```')
  assert.deepEqual(result, [{ kind: 'preference', content: 'User prefers tea', confidence: 0.95 }])
  assert.throws(() => parseMemoryCandidates('not json'), /JSON object/)
  assert.throws(() => parseMemoryCandidates(JSON.stringify({ memories: Array(65).fill({}) })))
  assert.throws(() => parseMemoryCandidates('x'.repeat(128 * 1024 + 1)), /size limit/)
})

test('memory extraction records the real bounded no-tools model request before transmission', async () => {
  const model = await recordedModel([{ text: '{"memories":[{"kind":"fact","content":"A confirmed fact","confidence":0.9}]}' }])
  const recorded: JsonValue[] = []
  try {
    const result = await extractMemoryCandidates({ model: model.config, userText: '😀'.repeat(6001), assistantText: 'Reply'.repeat(2000),
      signal: new AbortController().signal, async record(value) { assert.equal(model.requests.length, 0); recorded.push(value) } })
    assert.equal(result[0]?.content, 'A confirmed fact')
    assert.equal(recorded.length, 1)
    const request = model.requests[0]!
    assert.ok(!request.tools || (request.tools as unknown[]).length === 0)
    const messages = request.messages as { role: string; content: string | { text: string }[] }[]
    const user = messages.find(message => message.role === 'user')!
    const value = JSON.parse(typeof user.content === 'string' ? user.content : user.content[0]!.text)
    assert.equal(Array.from(value.userMessage).length, 6000)
    assert.equal(Array.from(value.assistantReply).length, 6000)
  } finally { await model.close() }
})

test('extraction persistence failure, empty source and pre-cancellation make no network request', async () => {
  const model = await recordedModel([{ text: '{"memories":[]}' }])
  try {
    const request = { model: model.config, userText: 'User text', assistantText: 'Reply', signal: new AbortController().signal,
      async record() { throw new Error('capture disk failure') } }
    await assert.rejects(extractMemoryCandidates(request), /persistence failed/)
    assert.equal(model.requests.length, 0)
    assert.deepEqual(await extractMemoryCandidates({ ...request, userText: ' ' }), [])
    const controller = new AbortController(); controller.abort(new Error('cancelled'))
    await assert.rejects(extractMemoryCandidates({ ...request, signal: controller.signal }), /cancelled/)
    assert.equal(model.requests.length, 0)
  } finally { await model.close() }
})

test('a tool call from the extractor model is rejected rather than executed', async () => {
  const model = await recordedModel([{ tool: 'remember_memory', input: { content: 'Must not execute' } }])
  try {
    await assert.rejects(extractMemoryCandidates({ model: model.config, userText: 'User', assistantText: 'Reply',
      signal: new AbortController().signal, async record() {} }), /text response|non-text/)
    assert.equal(model.requests.length, 1)
  } finally { await model.close() }
})

test('cancellation interrupts an extraction already waiting on the model', { timeout: 10000 }, async () => {
  const model = await recordedModel([{ wait: true }])
  const controller = new AbortController()
  try {
    const pending = extractMemoryCandidates({ model: model.config, userText: 'User', assistantText: 'Reply', signal: controller.signal, async record() {} })
    const rejected = assert.rejects(pending, /cancelled extraction/)
    const deadline = Date.now() + 5000
    while (!model.requests.length && Date.now() < deadline) await delay(10)
    assert.equal(model.requests.length, 1)
    controller.abort(new Error('cancelled extraction'))
    await rejected
  } finally { controller.abort(); await model.close() }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { completeText } from '../src/text-completion.ts'
import { recordedModel } from './recorded-model.ts'

test('text completion accepts reasoning followed by JSON without including reasoning', async () => {
  const fixture = await recordedModel([{ thinking: 'PRIVATE_REASONING', text: '{"memories":[]}' }])
  try {
    const text = await completeText({ model: fixture.config, systemPrompt: '提取记忆', text: '你好',
      signal: new AbortController().signal, async record() {} })
    assert.deepEqual(JSON.parse(text), { memories: [] })
    assert.doesNotMatch(text, /PRIVATE_REASONING/)
    assert.equal(fixture.requests.length, 1)
  } finally { await fixture.close() }
})

test('text completion rejects reasoning without an answer and unexpected tool calls', async () => {
  for (const reply of [{ thinking: 'still thinking', text: '' }, { tool: 'unexpected', input: {} }]) {
    const fixture = await recordedModel([reply])
    try {
      await assert.rejects(completeText({ model: fixture.config, systemPrompt: '', text: '你好',
        signal: new AbortController().signal, async record() {} }), /Model returned no text content|Model did not complete a text response/)
    } finally { await fixture.close() }
  }
})

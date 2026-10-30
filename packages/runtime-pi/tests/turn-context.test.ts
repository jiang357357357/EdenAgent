import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime, createIsolatedRuntime } from '../src/index.ts'
import { callbacks, recordedModel } from './recorded-model.ts'

for (const [name, factory] of [['harness', createRuntime], ['isolated', createIsolatedRuntime]] as const) {
  test(`${name}: turn memory preserves system/history, stays fixed across tools, and never persists`, async () => {
    const model = await recordedModel([{ text: 'first answer' }, { tool: 'lookup', input: {} }, { text: 'second answer' }, { text: 'third answer' }])
    const record = callbacks()
    const options = { sessionId: `memory-${name}`, systemPrompt: 'Stable system rules', model: model.config, callbacks: record.handlers,
      tools: [{ name: 'lookup', revision: '1', description: 'lookup', parameters: { type: 'object' }, async execute() { return 'lookup result' } }] }
    const runtimes: ReturnType<typeof factory>[] = []
    try {
      const first = factory(options); runtimes.push(first)
      await first.prompt('First question')
      const firstCheckpoint = await first.snapshot()
      const second = factory({ ...options, checkpoint: firstCheckpoint, turnContext: 'CURRENT_MEMORY_MARKER' }); runtimes.push(second)
      await second.prompt('Second question')
      assert.equal(model.requests.length, 3)
      const messages = (index: number) => model.requests[index]!.messages as { role: string; content: unknown }[]
      assert.deepEqual(messages(1).slice(0, messages(0).length), messages(0))
      assert.deepEqual(messages(2).slice(0, messages(1).length), messages(1))
      assert.equal(messages(1)[0]!.content, 'Stable system rules')
      assert.equal(JSON.stringify(messages(2)).split('CURRENT_MEMORY_MARKER').length - 1, 1)
      assert.match(JSON.stringify(messages(1).at(-1)), /CURRENT_MEMORY_MARKER/)
      assert.match(JSON.stringify(messages(1).at(-2)), /Second question/)
      const checkpoint = await second.snapshot()
      assert.doesNotMatch(JSON.stringify(checkpoint), /CURRENT_MEMORY_MARKER/)
      assert.doesNotMatch(JSON.stringify(record.events), /CURRENT_MEMORY_MARKER/)
      const third = factory({ ...options, checkpoint, turnContext: 'NEW_MEMORY_MARKER' }); runtimes.push(third)
      await third.prompt('Third question')
      assert.equal(messages(3)[0]!.content, messages(1)[0]!.content)
      assert.doesNotMatch(JSON.stringify(messages(3)), /CURRENT_MEMORY_MARKER/)
      assert.match(JSON.stringify(messages(3)), /NEW_MEMORY_MARKER/)
      assert.match(JSON.stringify(messages(3)), /first answer/)
      assert.match(JSON.stringify(messages(3)), /second answer/)
    } finally { await Promise.all(runtimes.map(runtime => runtime.dispose?.())); await model.close() }
  })
}

test('turn reference is budgeted but omitted from automatic summaries', async () => {
  const model = await recordedModel([{ text: 'A'.repeat(11000) }, { text: 'SUMMARY: older conversation' }, { text: 'continued' }])
  const record = callbacks()
  const options = { sessionId: 'memory-compaction', systemPrompt: '', model: { ...model.config, contextWindow: 10000 }, tools: [], callbacks: record.handlers }
  try {
    const first = createRuntime(options)
    await first.prompt('OLD '.repeat(1750))
    const next = createRuntime({ ...options, checkpoint: await first.snapshot(), turnContext: 'PRIVATE_REFERENCE' })
    await next.prompt('CURRENT '.repeat(1000))
    assert.equal(model.requests.length, 3)
    assert.doesNotMatch(JSON.stringify(model.requests[1]), /PRIVATE_REFERENCE/)
    assert.match(JSON.stringify(model.requests[2]), /PRIVATE_REFERENCE/)
    assert.doesNotMatch(JSON.stringify(await next.snapshot()), /PRIVATE_REFERENCE/)
  } finally { await model.close() }
})

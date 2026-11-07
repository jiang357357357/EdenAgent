import test from 'node:test'
import assert from 'node:assert/strict'
import { createIsolatedRuntime } from '../src/index.ts'
import { recordedModel, callbacks } from './recorded-model.ts'

test('leading closing rules stay after refreshed tool hints in IPC, with payload-bound provenance and compaction', async () => {
  const model = await recordedModel([{ text: 'first' }, { text: 'summary' }, { text: 'restored' }])
  const record = callbacks()
  let hint = 'initial tool instructions'
  const tool = () => ({ name: 'inspect', description: 'Inspect', revision: '1',
    promptHint: hint, parameters: { type: 'object', properties: {} }, async execute() { return null } })
  const runtime = createIsolatedRuntime({ sessionId: 'leading-rules', model: model.config,
    systemPrompt: 'active identity\n\nfixed behavioral rules', systemPromptSuffix: 'closing identity anchor',
    contextSources: [{ kind: 'system', title: 'mode audit', content: 'fixed behavioral rules', placement: 'leading' },
      { kind: 'system', title: 'anchor audit', content: 'closing identity anchor', placement: 'leading' }],
    tools: [tool()], refreshTools: () => [tool()], callbacks: record.handlers })
  try {
    await runtime.prompt('hello')
    await runtime.compact('keep useful history')
    hint = 'updated tool instructions'
    await runtime.prompt('continue')
    for (const index of [0, 2]) {
      const messages = model.requests[index]!.messages as { role: string; content: string }[]
      assert.equal(messages.filter(message => message.role === 'system').length, 1)
      assert.equal(messages[0]!.role, 'system')
      assert.ok(messages[0]!.content.startsWith('active identity\n\nfixed behavioral rules'))
      assert.ok(messages[0]!.content.endsWith('closing identity anchor'))
      assert.ok(messages[0]!.content.indexOf(index === 0 ? 'initial tool instructions' : 'updated tool instructions')
        < messages[0]!.content.indexOf('closing identity anchor'))
      assert.equal((record.requests[index] as { contextSources: unknown[] }).contextSources.length, 3)
    }
    const compacted = model.requests[1]!.messages as { content: string }[]
    assert.ok(!compacted.some(message => message.content.includes('fixed behavioral rules') || message.content.includes('closing identity anchor')))
    const compactSources = (record.requests[1] as { contextSources: { placement?: string }[] }).contextSources
    assert.ok(compactSources.every(source => source.placement !== 'leading'))
    const checkpoint = JSON.stringify(await runtime.snapshot())
    assert.ok(!checkpoint.includes('fixed behavioral rules') && !checkpoint.includes('closing identity anchor'))
  } finally { await runtime.dispose(); await model.close() }
})

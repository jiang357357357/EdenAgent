import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { createRuntime, createIsolatedRuntime, type RuntimeOptions, type RuntimeTool } from '../src/index.ts'
import { callbacks, recordedModel } from './recorded-model.ts'

const factories = { inline: createRuntime, isolated: (options: RuntimeOptions) => createIsolatedRuntime(options) }
const names = (request: Record<string, unknown>) => ((request.tools ?? []) as { function: { name: string } }[]).map(tool => tool.function.name)

for (const [mode, create] of Object.entries(factories)) {
  test(`${mode}: known deferred calls execute before loading, after unloading and after checkpoint recovery`, async t => {
    const model = await recordedModel([
      { tool: 'known_action', input: { text: 'first' } }, { tool: 'show_description', input: {} },
      { tool: 'known_action', input: { text: 'second' } }, { tool: 'hide_description', input: {} },
      { tool: 'known_action', input: { text: 'third' } }, { tool: 'missing_action', input: {} },
      { tool: 'known_action', input: { text: { invalid: true } } }, { text: 'done' },
      { tool: 'known_action', input: { text: 'recovered' } }, { text: 'recovered' },
    ])
    t.after(() => model.close())
    const audit = callbacks(), executed: unknown[] = [], before: string[] = [], after: string[] = []
    let shown = false
    const action: RuntimeTool = { name: 'known_action', revision: 'current', description: 'FULL_SCHEMA_MARKER', promptHint: 'PRIVATE_HINT_MARKER',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      modelResult: value => ({ projected: (value as { rawReceipt: string }).rawReceipt }),
      async execute(input) { executed.push(input.text); return { rawReceipt: input.text as string } } }
    const toggle = (name: string, value: boolean): RuntimeTool => ({ name, description: name, revision: '1',
      parameters: { type: 'object', properties: {} }, async execute() { shown = value; return null } })
    const tools = () => [{ ...action, exposure: shown ? 'direct' as const : 'deferred' as const }, toggle('show_description', true), toggle('hide_description', false)]
    const options: RuntimeOptions = { sessionId: randomUUID(), systemPrompt: 'fixture', model: model.config, tools: tools(), refreshTools: tools,
      callbacks: { ...audit.handlers, async beforeTool(name) { before.push(name) }, async afterTool(id) { after.push(id) } } }
    const runtime = create(options); t.after(() => runtime.dispose?.())
    await runtime.prompt('Use the known action without loading its description.')
    assert.deepEqual(executed, ['first', 'second', 'third'])
    assert.deepEqual(before, ['known_action', 'show_description', 'known_action', 'hide_description', 'known_action'])
    assert.equal(new Set(after).size, 5)
    assert.equal(after.length, 5)
    assert.deepEqual(model.requests.map(request => names(request).includes('known_action')), [false, false, true, true, false, false, false, false])
    for (const index of [0, 1, 4, 5, 6, 7]) {
      const request = audit.requests[index] as Record<string, unknown>
      assert.doesNotMatch(JSON.stringify(request.tools), /known_action|FULL_SCHEMA_MARKER/)
      assert.doesNotMatch(JSON.stringify(request.promptHints), /PRIVATE_HINT_MARKER/)
      assert.doesNotMatch(JSON.stringify(request.contextSources), /PRIVATE_HINT_MARKER/)
      const system = (model.requests[index]!.messages as { role: string }[]).filter(message => message.role === 'system')
      assert.doesNotMatch(JSON.stringify(system), /PRIVATE_HINT_MARKER/)
    }
    assert.match(JSON.stringify(model.requests[2]), /PRIVATE_HINT_MARKER|FULL_SCHEMA_MARKER/)
    const messages = JSON.stringify(model.requests[7]!.messages)
    assert.match(messages, /not found/)
    assert.match(messages, /projected/)
    assert.doesNotMatch(messages, /rawReceipt/)
    const checkpoint = await runtime.snapshot()
    await runtime.dispose?.()
    const restored = create({ ...options, tools: tools(), checkpoint }); t.after(() => restored.dispose?.())
    await restored.prompt('Continue the known action from history.')
    assert.deepEqual(executed, ['first', 'second', 'third', 'recovered'])
    assert.equal(before.length, 6)
    assert.equal(after.length, 6)
    assert.ok(!names(model.requests[8]!).includes('known_action'))
    assert.match(JSON.stringify(model.requests[8]!.messages), /third/)
    t.diagnostic(JSON.stringify({ mode, schemaVisible: model.requests.map(request => names(request).includes('known_action')), executions: executed, before: before.length, after: after.length, recoveredFromCheckpoint: true }))
  })

  test(`${mode}: unshown definitions and hints do not consume model context budget`, async t => {
    const model = await recordedModel([{ tool: 'large_action', input: {} }, { text: 'done' }]); t.after(() => model.close())
    let effects = 0
    const audit = callbacks()
    const runtime = create({ sessionId: randomUUID(), systemPrompt: 'small', model: { ...model.config, contextWindow: 4096, maxTokens: 512 },
      tools: [{ name: 'large_action', revision: '1', exposure: 'deferred', description: 'x'.repeat(100_000), promptHint: 'y'.repeat(100_000),
        parameters: { type: 'object', properties: {} }, async execute() { effects++; return { ok: true } } },
      { name: 'hidden_action', revision: '1', exposure: 'hidden', description: 'z'.repeat(100_000), parameters: { type: 'object', properties: {} }, async execute() { return null } }],
      callbacks: audit.handlers })
    t.after(() => runtime.dispose?.())
    await runtime.prompt('Run the known action.')
    assert.equal(effects, 1)
    assert.equal(model.requests.length, 2)
    assert.ok(model.requests.every(request => names(request).length === 0))
    assert.ok(!audit.events.some(event => event.kind === 'auto_compaction_start'))
  })
}

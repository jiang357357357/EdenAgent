import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRuntime, type RuntimeTool } from '../src/index.ts'
import { callbacks, recordedModel } from './recorded-model.ts'

test('a running tool loop replaces removed tools and skill hints before its next HTTP request', async () => {
  const model = await recordedModel([{ tool: 'refresh_catalog', input: {} }, { tool: 'new_skill', input: {} }, { text: 'done' }])
  const audit = callbacks()
  let updated = false, calls = 0
  const make = (name: string, hint: string, execute: RuntimeTool['execute']): RuntimeTool => ({ name, revision: hint,
    description: name, parameters: { type: 'object', properties: {} }, promptHint: hint, execute })
  const before = [make('refresh_catalog', 'CATALOG_BEFORE', async () => { updated = true; return null }),
    make('old_skill', '', async () => { throw new Error('Removed tool executed') })]
  const after = [make('new_skill', 'CATALOG_AFTER', async () => { calls++; return { executed: true } })]
  try {
    const runtime = createRuntime({ sessionId: 'refresh', model: model.config, systemPrompt: 'Use the available tools.', tools: before,
      refreshTools: () => updated ? after : before, callbacks: audit.handlers })
    await runtime.prompt('Refresh and execute the new skill')
    assert.equal(calls, 1)
    assert.equal(model.requests.length, 3)
    const names = (index: number) => (model.requests[index]!.tools as { function: { name: string } }[]).map(tool => tool.function.name)
    assert.deepEqual(names(0), ['refresh_catalog', 'old_skill'])
    assert.deepEqual(names(1), ['new_skill'])
    assert.match(JSON.stringify(model.requests[1]!.messages), /CATALOG_AFTER/)
    assert.doesNotMatch(JSON.stringify(model.requests[1]!.messages), /CATALOG_BEFORE/)
    assert.match(JSON.stringify(audit.requests[1]), /CATALOG_AFTER/)
    assert.ok((await runtime.snapshot()).entries.length > 0)
  } finally { await model.close() }
})

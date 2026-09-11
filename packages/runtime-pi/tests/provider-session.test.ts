import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRuntime } from '../src/index.ts'
import { recordedModel, callbacks } from './recorded-model.ts'

test('OpenCode routing identity survives tools and restore but separates conversations', async () => {
  const fixture = await recordedModel([{ tool: 'echo', input: {} }, { text: 'Done' }, { text: 'Restored' }, { text: 'Other' }])
  try {
    const options = { sessionId: 'first', model: { ...fixture.config, provider: 'opencode-go' }, systemPrompt: '', callbacks: callbacks().handlers,
      tools: [{ name: 'echo', revision: '1', description: 'Echo', parameters: { type: 'object', properties: {} }, async execute() { return { ok: true } } }] }
    const runtime = createRuntime(options)
    await runtime.prompt('Use echo')
    const restored = createRuntime({ ...options, checkpoint: await runtime.snapshot() })
    await restored.prompt('Continue')
    await createRuntime({ ...options, sessionId: 'second' }).prompt('Hello')
    assert.equal(fixture.headers.length, 4)
    const ids = fixture.headers.map(header => header['x-opencode-session'])
    assert.match(String(ids[0]), /^[a-f0-9]{64}$/)
    assert.equal(ids[0], ids[1]); assert.equal(ids[0], ids[2]); assert.notEqual(ids[0], ids[3])
    assert.ok(fixture.headers.every(header => String(header['user-agent']).startsWith('eden-agent/')))
  } finally { await fixture.close() }
})

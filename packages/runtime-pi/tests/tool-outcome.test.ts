import assert from 'node:assert/strict'
import test from 'node:test'
import { adaptTool } from '../src/tool-adapter.ts'
import type { RuntimeTool, ToolOutcome } from '../src/index.ts'
import { callbacks } from './recorded-model.ts'

test('business failure is committed once and reported as an error to pi', async () => {
  const audit = callbacks(), outcomes: (ToolOutcome | undefined)[] = []
  const tool: RuntimeTool = { name: 'remote', revision: '1', description: '', parameters: { type: 'object', properties: {} },
    outcome: () => 'failed', async execute() { return { isError: true, content: [{ type: 'text', text: 'rejected' }] } } }
  const adapted = adaptTool(tool, { ...audit.handlers, async afterTool(_id, _result, _failed, outcome) { outcomes.push(outcome) } }, () => {}, error => { throw error })
  await assert.rejects(adapted.execute('call', {}, new AbortController().signal, undefined, undefined), /rejected/)
  assert.deepEqual(outcomes, ['failed'])
})

test('forwarding validates final input and accounts only the final tool', async () => {
  const audit = callbacks(), names: string[] = []
  const target: RuntimeTool = { name: 'specific', revision: '2', description: '',
    parameters: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false },
    async execute(input) { return input.value as number } }
  const wrapper: RuntimeTool = { name: 'generic', revision: '1', description: '', parameters: { type: 'object' },
    resolveCall: input => ({ tool: target, input }), async execute() { throw new Error('Wrapper must not execute') } }
  const adapted = adaptTool(wrapper, { ...audit.handlers, async beforeTool(name) { names.push(name) } }, () => {}, error => { throw error })
  await assert.rejects(adapted.execute('bad', {}, new AbortController().signal, undefined, undefined), /value/)
  assert.equal(names.length, 0)
  await adapted.execute('good', { value: 42 }, new AbortController().signal, undefined, undefined)
  assert.deepEqual(names, ['specific'])
})

test('image projection preserves original audit data and uncertain execution remains unknown', async () => {
  const audit = callbacks(), results: unknown[] = [], outcomes: (ToolOutcome | undefined)[] = []
  const tool: RuntimeTool = { name: 'remote', revision: '1', description: '', parameters: { type: 'object', properties: {} },
    modelResult: () => ({ image: 'reference' }), async execute() { return { image: 'raw-bytes' } } }
  const handlers = { ...audit.handlers, async afterTool(_id: string, result: unknown, _failed: boolean, outcome?: ToolOutcome) { results.push(result); outcomes.push(outcome) } }
  const adapted = adaptTool(tool, handlers, () => {}, error => { throw error })
  const result = await adapted.execute('image', {}, new AbortController().signal, undefined, undefined)
  assert.doesNotMatch(JSON.stringify(result.content), /raw-bytes/)
  assert.deepEqual(results[0], { image: 'raw-bytes' })
  tool.execute = async () => { throw Object.assign(new Error('connection lost'), { toolOutcome: 'unknown' }) }
  await assert.rejects(adapted.execute('lost', {}, new AbortController().signal, undefined, undefined), /connection lost/)
  assert.deepEqual(outcomes, ['completed', 'unknown'])
})

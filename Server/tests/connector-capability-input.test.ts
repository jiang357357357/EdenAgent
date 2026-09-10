import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capabilityInput } from '../src/modules/connectors/capability-input.ts'

test('connector schemas preserve required fields, bounds, enum and strict object behavior', () => {
  const schema = capabilityInput({ type: 'object', properties: {
    name: { type: 'string', minLength: 2, pattern: '^[a-z]+$', enum: ['ok', 'good'] },
    counts: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 3 }, maxItems: 2 },
    enabled: { type: 'boolean' }, nothing: { type: 'null' },
  }, required: ['name', 'counts'] })
  assert.deepEqual(schema.parse({ name: 'ok', counts: [1, 3] }), { name: 'ok', counts: [1, 3] })
  for (const value of [{ name: 'no', counts: [] }, { name: 'ok', counts: [1.5] }, { name: 'ok', counts: [4] }, { name: 'ok', counts: [], extra: true }, { counts: [] }]) assert.equal(schema.safeParse(value).success, false)
  assert.deepEqual(capabilityInput({ type: 'object', additionalProperties: true }).parse({ extra: true }), { extra: true })
})

test('connector schema parser rejects unsupported vocabulary, missing required declarations and nesting', () => {
  assert.throws(() => capabilityInput({ type: 'string', unexpected: true }), /keyword/)
  assert.throws(() => capabilityInput({ type: 'object', required: ['missing'] }), /Undeclared/)
  assert.throws(() => capabilityInput({ type: 'string' }, 13), /Invalid/)
  assert.throws(() => capabilityInput(null), /Invalid/)
  assert.equal(capabilityInput({ type: 'string', format: 'uuid' }).safeParse('no').success, false)
})

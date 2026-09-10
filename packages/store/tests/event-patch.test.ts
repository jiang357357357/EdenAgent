import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyLegacyEventPatch } from '../src/legacy/event-patch.ts'

test('legacy patches preserve nested edits, deletion and null-filled array growth', () => {
  const base = { text: 'a', removed: true, list: [1] }
  const result = applyLegacyEventPatch(base, { Object: [{ text: { Append: 'b' }, list: { Array: [{ 2: { Replace: 3 } }, 3] } }, ['removed']] })
  assert.deepEqual({ ...result as object }, { text: 'ab', list: [1, null, 3] })
  assert.deepEqual(base, { text: 'a', removed: true, list: [1] })
})

test('legacy patches reject malformed tags, invalid array indices and deep recursion', () => {
  for (const patch of [{ Array: [{ '01': { Replace: 1 } }, 2] }, { Array: [{ 2: { Replace: 1 } }, 2] }, { Array: [{}, 1000001] }, { Replace: 1, Append: 'x' }]) {
    assert.throws(() => applyLegacyEventPatch([], patch))
  }
  assert.throws(() => applyLegacyEventPatch([], { Object: [{}, []] }), /does not match/)
  assert.throws(() => applyLegacyEventPatch({}, { Replace: 1 }, 129), /Invalid/)
  const result = applyLegacyEventPatch({}, JSON.parse('{"Object":[{"__proto__":{"Replace":{"polluted":true}}},[]]}')) as Record<string, unknown>
  assert.equal(Object.getPrototypeOf(result), null)
  assert.equal(Object.hasOwn(result, '__proto__'), true)
  assert.equal(Object.hasOwn({}, 'polluted'), false)
})

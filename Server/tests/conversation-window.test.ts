import assert from 'node:assert/strict'
import { test } from 'node:test'
import { conversationWindow } from '../src/modules/sessions/history/conversation-window.ts'

test('shared context keeps recent messages in order and bounds serialized JSON including escaped Unicode text', () => {
  const old = { message: { role: 'user', content: 'OLD_PREFIX ' + '😀\n"'.repeat(1000) + ' RECENT_TAIL' } }
  const newest = { actor: { assistantID: 2 }, message: { role: 'assistant', content: [{ type: 'text', text: 'Newest reply' }] } }
  const result = conversationWindow([old, newest], 240) as Record<string, unknown>[]
  assert.ok(JSON.stringify(result).length <= 240)
  assert.equal(result.length, 2)
  assert.equal(result[0]?.truncated, true)
  assert.match(String(result[0]?.text), /RECENT_TAIL$/)
  assert.doesNotMatch(String(result[0]?.text), /OLD_PREFIX/)
  assert.equal(result[1]?.text, 'Newest reply')
  assert.equal(result[1]?.assistantID, 2)
  assert.equal(Buffer.from(String(result[0]?.text), 'utf8').toString('utf8'), result[0]?.text)
})

test('shared context excludes private blocks and handles empty and invalid budgets explicitly', () => {
  assert.deepEqual(conversationWindow([], 2), [])
  assert.deepEqual(conversationWindow([{ message: { role: 'toolResult', content: 'Private output' } }]), [])
  assert.throws(() => conversationWindow([], 1), /Invalid/)
  const result = conversationWindow([{ message: { role: 'assistant', content: [
    { type: 'thinking', thinking: 'PRIVATE' }, { type: 'text', text: 'Public' },
  ] } }])
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/)
  assert.deepEqual(result, [{ role: 'assistant', text: 'Public' }])
})

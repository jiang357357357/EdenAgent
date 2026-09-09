import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDirectorPlan } from '../src/modules/director/index.ts'

const roster = [{ assistantId: 1, assistantName: '甲', characterName: '共同名字' },
  { assistantId: 2, assistantName: '乙', characterName: '共同名字' }, { assistantId: 3, assistantName: '丙' }]

test('director normalizes bounded turns while rejecting unknown, consecutive and excessive speakers', () => {
  const plan = parseDirectorPlan(JSON.stringify({
    scene: { domain: 'invalid', interactionType: 'invalid', confidence: 2, summary: '讨论' },
    execution: { mode: 'solo', leadAssistantId: 99, toolOwnerAssistantId: 99, observationStrategy: 'invalid' },
    beats: [{ assistantId: 1 }, { assistantId: 1 }, { assistantId: 99 }, { assistantId: 2, addressTo: 'assistant:99' },
      { assistantId: 1 }, { assistantId: 2 }, { assistantId: 1 }, { assistantId: 3 }, { assistantId: 2 }],
  }), roster, '讨论')
  assert.deepEqual(plan.beats.map(beat => beat.assistantID), [1, 2, 1, 2, 3])
  assert.equal(plan.beats[1]?.addressTo, 'assistant:1')
  assert.equal(plan.scene.domain, 'general')
  assert.equal(plan.scene.confidence, 1)
  assert.equal(plan.execution.mode, 'lead_support')
  assert.equal(plan.execution.leadAssistantID, 1)
  assert.equal(plan.execution.toolOwnerAssistantID, undefined)
})

test('director aliases are unambiguous and reply references track surviving original beats', () => {
  const plan = parseDirectorPlan(JSON.stringify({ turns: [
    { name: '共同名字' }, { name: '甲' }, { name: '甲' },
    { assistant_id: '2', reply_to_beat: 1, address_to: 'assistant:甲' },
    { name: '丙', replyToBeat: 2 }, { name: '乙', replyToBeat: 99 },
  ] }), roster, '讨论')
  assert.deepEqual(plan.beats.map(beat => beat.assistantID), [1, 2, 3, 2])
  assert.equal(plan.beats[1]?.replyToBeat, 0)
  assert.equal(plan.beats[1]?.addressTo, 'assistant:1')
  assert.equal(plan.beats[2]?.replyToBeat, undefined)
  assert.equal(plan.beats[3]?.replyToBeat, undefined)
})

test('invalid plans have a diagnostic fallback while an invalid roster is rejected', () => {
  for (const output of ['broken', '{"beats":[]}', '{"beats":[{"assistantId":99}]}', 'x'.repeat(1024 * 1024 + 1)]) {
    const plan = parseDirectorPlan(output, roster, '请乙回答')
    assert.equal(plan.source, 'fallback')
    assert.ok(plan.diagnostic)
    assert.equal(plan.beats[0]?.assistantID, 2)
    assert.equal(plan.execution.mode, 'solo')
  }
  assert.throws(() => parseDirectorPlan('{}', [], 'test'))
  assert.throws(() => parseDirectorPlan('{}', [{ assistantId: 1 }, { assistantId: '1' }], 'test'), /Duplicate/)
  const single = parseDirectorPlan('irrelevant', [roster[0]], 'test')
  assert.equal(single.source, 'single')
  assert.equal(single.beats[0]?.assistantID, 1)
})

test('director projections exclude unrecognized credentials and preserve bounded Unicode text', () => {
  const text = '😀'.repeat(200)
  const plan = parseDirectorPlan(JSON.stringify({ apiKey: 'plan-secret', scene: { summary: text },
    beats: [{ assistantId: 1, intent: text, credential: 'beat-secret' }] }),
  [{ ...roster[0], apiKey: 'roster-secret' }, roster[1]], 'test')
  assert.equal([...plan.scene.summary].length, 120)
  assert.equal([...plan.beats[0]!.intent].length, 160)
  assert.doesNotMatch(JSON.stringify(plan), /secret|apiKey|credential/)
})

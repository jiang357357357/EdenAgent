import assert from 'node:assert/strict'
import test from 'node:test'
import { AUTOMATIC_COMPACTION_INSTRUCTION, historicalMessageSegment, legacyConversationHistory, MANUAL_COMPACTION_INSTRUCTION, publicHandoffHistory } from '../src/model-prompts.ts'

test('runtime-owned compaction and history prompts are Chinese', () => {
  const values = [
    MANUAL_COMPACTION_INSTRUCTION,
    AUTOMATIC_COMPACTION_INSTRUCTION,
    historicalMessageSegment(1, 1, '历史'),
    publicHandoffHistory([]),
    legacyConversationHistory({}),
  ]
  for (const value of values) {
    assert.match(value, /[\u3400-\u9fff]/u)
    assert.doesNotMatch(value, /\b(?:You are|Summarize the conversation|Return strict JSON)\b/u)
    assert.doesNotMatch(value, /不能|不要|不得|禁止|不允许|只允许|必须|不授予|不执行|不保存|不加|不把/u)
  }
})

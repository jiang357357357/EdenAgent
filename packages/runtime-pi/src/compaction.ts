import { compact, DEFAULT_COMPACTION_SETTINGS, prepareCompaction } from '@earendil-works/pi-agent-core'
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core'
import type { createRuntimeModels } from './model-provider.ts'
import type { RuntimeModel } from './contracts.ts'
import { MANUAL_COMPACTION_INSTRUCTION } from './model-prompts.ts'

/** Manual compaction must summarize real history, even below the SDK's 20k retention default. */
export async function compactConversation(entries: SessionTreeEntry[], provider: ReturnType<typeof createRuntimeModels>, model: RuntimeModel, signal: AbortSignal, instructions?: string) {
  const prepared = prepareCompaction(entries, { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 4096 })
  if (!prepared.ok) throw prepared.error
  const summarizeWholeConversation = prepared.value !== undefined && !hasHistory(prepared.value)
  if (prepared.value && summarizeWholeConversation) {
    prepared.value.messagesToSummarize = [...prepared.value.messagesToSummarize, ...prepared.value.turnPrefixMessages, ...prepared.value.retainedTail]
    prepared.value.turnPrefixMessages = []
    prepared.value.retainedTail = []
    prepared.value.isSplitTurn = false
  }
  if (!prepared.value || !hasHistory(prepared.value)) throw new Error('没有可压缩的对话内容，请在新增对话后重试。')
  signal.throwIfAborted()
  const result = await compact(prepared.value, provider.models, provider.model, instructions?.trim() || MANUAL_COMPACTION_INSTRUCTION, signal, model.reasoning ?? 'off', { enabled: false, maxRetries: 0, baseDelayMs: 0 })
  if (!result.ok) throw result.error
  signal.throwIfAborted()
  if (!result.value.summary.trim()) throw new Error('压缩模型返回空摘要，原对话已保留。')
  if (summarizeWholeConversation) delete result.value.firstKeptEntryId
  return result.value
}

function hasHistory(preparation: { messagesToSummarize: unknown[]; turnPrefixMessages: unknown[] }) {
  return preparation.messagesToSummarize.length + preparation.turnPrefixMessages.length > 0
}

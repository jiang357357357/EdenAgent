import { DEFAULT_COMPACTION_SETTINGS, prepareCompaction } from '@earendil-works/pi-agent-core'
import type { SessionTreeEntry } from '@earendil-works/pi-agent-core'
import type { createRuntimeModels } from './model-provider.ts'
import type { RuntimeModel } from './contracts.ts'
import { MANUAL_COMPACTION_INSTRUCTION } from './model-prompts.ts'
import { progressiveCompaction } from './progressive-compaction.ts'
import type { DurableSessionStorage } from './durable-session.ts'
import type { RuntimeCallbacks } from './contracts.ts'

/** Manual compaction must summarize real history, even below the SDK's 20k retention default. */
export async function compactConversation(entries: SessionTreeEntry[], provider: ReturnType<typeof createRuntimeModels>, model: RuntimeModel,
  signal: AbortSignal, storage: DurableSessionStorage, callbacks: Pick<RuntimeCallbacks, 'event'>, instructions?: string) {
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
  const source = prepared.value
  const messages = [...source.messagesToSummarize, ...source.turnPrefixMessages]
  if (source.previousSummary) messages.unshift({ role: 'user', content: source.previousSummary, timestamp: 0 })
  const result = await progressiveCompaction(storage, messages, provider, model, signal,
    instructions?.trim() || MANUAL_COMPACTION_INSTRUCTION, callbacks)
  return { ...result, tokensBefore: source.tokensBefore, retainedTail: source.retainedTail,
    ...(summarizeWholeConversation ? {} : { firstKeptEntryId: source.firstKeptEntryId }),
    details: { readFiles: [...source.fileOps.read], modifiedFiles: [...new Set([...source.fileOps.written, ...source.fileOps.edited])] } }
}

function hasHistory(preparation: { messagesToSummarize: unknown[]; turnPrefixMessages: unknown[] }) {
  return preparation.messagesToSummarize.length + preparation.turnPrefixMessages.length > 0
}

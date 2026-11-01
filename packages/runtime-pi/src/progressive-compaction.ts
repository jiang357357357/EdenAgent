import { setImmediate as yieldTurn } from 'node:timers/promises'
import { generateSummaryWithUsage } from '@earendil-works/pi-agent-core'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Usage } from '@earendil-works/pi-ai'
import type { DurableSessionStorage } from './durable-session.ts'
import type { RuntimeCallbacks, RuntimeModel } from './contracts.ts'
import type { createRuntimeModels } from './model-provider.ts'
import { contextSize } from './context-size.ts'
import { compactionSegments } from './compaction-segments.ts'
import { compactionKey, compactionPrefixes, restoreCompactionProgress, saveCompactionProgress } from './compaction-progress.ts'

function addUsage(previous: Usage | undefined, next: Usage): Usage {
  const cost = Object.fromEntries(Object.entries(next.cost).map(([key, value]) =>
    [key, value + (previous?.cost[key as keyof Usage['cost']] ?? 0)])) as Usage['cost']
  return { input: (previous?.input ?? 0) + next.input, output: (previous?.output ?? 0) + next.output,
    cacheRead: (previous?.cacheRead ?? 0) + next.cacheRead, cacheWrite: (previous?.cacheWrite ?? 0) + next.cacheWrite,
    totalTokens: (previous?.totalTokens ?? 0) + next.totalTokens, cost }
}

async function requestSummary(messages: AgentMessage[], provider: ReturnType<typeof createRuntimeModels>,
  maxTokens: number, signal: AbortSignal, instruction: string, previous?: string) {
  const result = await generateSummaryWithUsage(messages, provider.models, provider.model, maxTokens, signal,
    instruction, previous, 'off', { enabled: false, maxRetries: 0, baseDelayMs: 0 })
  if (!result.ok) throw result.error
  if (!result.value.text.trim()) throw new Error('压缩模型返回空摘要，已保留原始历史和压缩进度。')
  return result.value
}

/** Each accepted summary advances a durable cursor. The existing runtime request budget still bounds cost. */
export async function progressiveCompaction(storage: DurableSessionStorage, messages: AgentMessage[],
  provider: ReturnType<typeof createRuntimeModels>, model: RuntimeModel, signal: AbortSignal,
  instruction: string, callbacks: Pick<RuntimeCallbacks, 'event'>, summaryBudget = 4096) {
  const budget = model.contextWindow - model.maxTokens - 2048 - contextSize(instruction)
  if (budget <= 0 || summaryBudget <= 0) throw new Error('模型窗口不足以容纳压缩请求。')
  const segments = compactionSegments(messages, Math.floor(budget / 2))
  if (!segments.length) throw new Error('没有可压缩的对话内容。')
  const maxTokens = Math.max(1, Math.min(model.maxTokens, 2048, Math.floor(summaryBudget / 2)))
  const key = compactionKey({ provider: model.provider, model: model.id, budget, instruction })
  const prefixes = compactionPrefixes(segments)
  const restored = await restoreCompactionProgress(storage, key, prefixes)
  let completed = restored?.completed ?? 0, summary = restored?.summary, usage = restored?.usage
  let requests = 0
  await callbacks.event('compaction_progress', { processed: completed, total: segments.length, resumed: completed > 0, requests })
  while (completed < segments.length) {
    signal.throwIfAborted()
    let end = completed, size = contextSize(summary)
    const batch: AgentMessage[] = []
    while (end < segments.length && size + contextSize([segments[end]]) <= budget) {
      const message = segments[end++]!
      batch.push(message); size += contextSize([message])
    }
    if (!batch.length) throw new Error('历史消息与摘要超过压缩容量，已保留原始历史和压缩进度。')
    const result = await requestSummary(batch, provider, maxTokens, signal, instruction, summary)
    summary = result.text; usage = addUsage(usage, result.usage)
    await saveCompactionProgress(storage, { key, completed: end, prefix: prefixes[end]!, summary, usage })
    completed = end; requests++
    await callbacks.event('compaction_progress', { processed: completed, total: segments.length, resumed: Boolean(restored), requests })
    if (requests % 32 === 0) await yieldTurn(undefined, { signal })
  }
  if (contextSize(summary) > summaryBudget) {
    const result = await requestSummary([{ role: 'user', content: summary!, timestamp: 0 }], provider, maxTokens, signal, instruction)
    summary = result.text; usage = addUsage(usage, result.usage)
    if (contextSize(summary) > summaryBudget) throw new Error('摘要仍超过当前可用空间，原始历史和压缩进度已保留。')
    await saveCompactionProgress(storage, { key, completed, prefix: prefixes[completed]!, summary, usage })
  }
  signal.throwIfAborted()
  return { summary: summary!, usage: usage! }
}

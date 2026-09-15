import { generateSummaryWithUsage, serializeConversation } from '@earendil-works/pi-agent-core'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { toJson } from '@eden/api'
import type { DurableSessionStorage } from './durable-session.ts'
import type { RuntimeCallbacks, RuntimeModel, RuntimeTool } from './contracts.ts'
import type { createRuntimeModels } from './model-provider.ts'
import { AUTOMATIC_COMPACTION_INSTRUCTION, historicalMessageSegment } from './model-prompts.ts'

/** Conservative text budgeting; provider framing and image accounting are not exact locally. */
export function contextSize(value: unknown): number {
  let images = 0
  const text = JSON.stringify(value, (_key, item) => {
    if (item?.type === 'image' && typeof item.data === 'string') { images++; return { type: 'image', mimeType: item.mimeType } }
    return item
  }) ?? ''
  let wide = 0
  for (const character of text) if (/[\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff]/u.test(character)) wide++
  return wide + Math.ceil((text.length - wide) / 3) + images * 8192
}

export function automaticCompactor(storage: DurableSessionStorage, provider: ReturnType<typeof createRuntimeModels>, model: RuntimeModel,
  callbacks: RuntimeCallbacks, configuration: () => { system: string; tools: RuntimeTool[]; signal: AbortSignal }) {
  return async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    const { system, tools, signal } = configuration()
    const persistent = storage.persistentContext(messages)
    const transientSize = Math.max(0, contextSize(storage.transientContext(messages)) - contextSize(persistent))
    const fixed = transientSize + contextSize({ system, tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) })
    const budget = model.contextWindow - model.maxTokens - Math.max(512, Math.ceil(model.contextWindow * 0.05))
    const before = fixed + contextSize(persistent)
    if (before <= budget) return messages
    if (fixed >= budget) throw new Error('系统提示和工具定义已占满可用上下文，无法通过压缩对话释放足够空间。')
    const last = persistent.at(-1)
    const tail = last?.role === 'user' ? [last] : []
    const history = tail.length ? persistent.slice(0, -1) : persistent
    if (!history.length || fixed + contextSize(tail) >= budget) throw new Error('当前输入超过模型可用上下文，请缩小本次输入或附件。')
    await callbacks.event('auto_compaction_start', toJson({ tokensBefore: before }))
    try {
      const summary = await summarize(history, provider, model, signal)
      signal.throwIfAborted()
      const candidate: AgentMessage[] = [{ role: 'user', content: summary, timestamp: Date.now() }, ...tail]
      const after = fixed + contextSize(candidate) + 256
      if (after >= before || after > budget) throw new Error('自动压缩后仍超出可用上下文，已保留原始历史并停止本次请求。')
      const session = storage.session()
      const id = await session.appendCompaction(summary, undefined, before, { automatic: true, tokensAfter: after }, true, undefined, tail)
      await callbacks.event('session_compact', toJson({ compactionEntry: await session.getEntry(id), automatic: true, tokensAfter: after }))
      return (await session.buildContext()).messages
    } catch (error) {
      await callbacks.event('auto_compaction_failed', toJson({ message: error instanceof Error ? error.message : String(error) }))
      throw error
    }
  }
}

async function summarize(messages: AgentMessage[], provider: ReturnType<typeof createRuntimeModels>, model: RuntimeModel, signal: AbortSignal) {
  const budget = model.contextWindow - model.maxTokens - 2048
  if (budget <= 0) throw new Error('模型窗口不足以容纳压缩请求。')
  let summary: string | undefined
  let batch: AgentMessage[] = []
  let calls = 0
  const flush = async () => {
    if (++calls > 32) throw new Error('自动压缩请求次数达到上限，原始历史已保留。')
    signal.throwIfAborted()
    const result = await generateSummaryWithUsage(batch, provider.models, provider.model, Math.min(model.maxTokens, 2048), signal,
      AUTOMATIC_COMPACTION_INSTRUCTION, summary, 'off', { enabled: false, maxRetries: 0, baseDelayMs: 0 })
    if (!result.ok) throw result.error
    if (!result.value.text.trim()) throw new Error('自动压缩返回空摘要。')
    summary = result.value.text
    batch = []
  }
  for (const message of summarySegments(messages, Math.floor(budget / 2))) {
    if (contextSize([message]) + contextSize(summary) > budget) throw new Error('单条历史消息超过压缩请求容量，原始内容已保留。')
    if (batch.length && contextSize([...batch, message]) + contextSize(summary) > budget) await flush()
    if (contextSize([message]) + contextSize(summary) > budget) throw new Error('历史消息与摘要超过压缩容量。')
    batch.push(message)
  }
  if (batch.length) await flush()
  return summary!
}

function summarySegments(messages: AgentMessage[], budget: number): AgentMessage[] {
  return messages.flatMap(message => {
    if (contextSize(message) <= budget) return [message]
    const serialized = message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult'
      ? serializeConversation([message]) : JSON.stringify(message)
    const characters = [...serialized]
    const segments: AgentMessage[] = []
    // One Unicode character per budget unit also bounds Chinese and escaped text conservatively.
    const size = Math.max(1, Math.floor(budget / 2))
    const total = Math.ceil(characters.length / size)
    for (let offset = 0; offset < characters.length; offset += size) {
      segments.push({ role: 'user', timestamp: Date.now(), content: historicalMessageSegment(Math.floor(offset / size) + 1, total, characters.slice(offset, offset + size).join('')) })
    }
    return segments
  })
}

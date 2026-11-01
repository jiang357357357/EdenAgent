import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { toJson } from '@eden/api'
import type { DurableSessionStorage } from './durable-session.ts'
import type { RuntimeCallbacks, RuntimeModel, RuntimeTool } from './contracts.ts'
import type { createRuntimeModels } from './model-provider.ts'
import { AUTOMATIC_COMPACTION_INSTRUCTION } from './model-prompts.ts'
import { contextSize } from './context-size.ts'
import { progressiveCompaction } from './progressive-compaction.ts'

export { contextSize } from './context-size.ts'

export function automaticCompactor(storage: DurableSessionStorage, provider: ReturnType<typeof createRuntimeModels>, model: RuntimeModel,
  callbacks: RuntimeCallbacks, configuration: () => { system: string; tools: RuntimeTool[]; signal: AbortSignal; turnContext?: string }) {
  return async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    const { system, tools, signal, turnContext } = configuration()
    const persistent = storage.persistentContext(messages)
    const transientSize = Math.max(0, contextSize(storage.transientContext(messages)) - contextSize(persistent))
    const fixed = transientSize + contextSize(turnContext ?? '') + contextSize({ system, tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })) })
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
      const { summary, usage } = await progressiveCompaction(storage, history, provider, model, signal,
        AUTOMATIC_COMPACTION_INSTRUCTION, callbacks, budget - fixed - contextSize(tail) - 256)
      const candidate: AgentMessage[] = [{ role: 'user', content: summary, timestamp: Date.now() }, ...tail]
      const after = fixed + contextSize(candidate) + 256
      if (after >= before || after > budget) throw new Error('自动压缩后仍超出可用上下文，已保留原始历史并停止本次请求。')
      const session = storage.session()
      const id = await session.appendCompaction(summary, undefined, before, { automatic: true, tokensAfter: after }, true, usage, tail)
      await callbacks.event('session_compact', toJson({ compactionEntry: await session.getEntry(id), automatic: true, tokensAfter: after }))
      return (await session.buildContext()).messages
    } catch (error) {
      await callbacks.event('auto_compaction_failed', toJson({ message: error instanceof Error ? error.message : String(error) }))
      throw error
    }
  }
}

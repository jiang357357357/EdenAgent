import { serializeConversation } from '@earendil-works/pi-agent-core'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { contextSize } from './context-size.ts'
import { historicalMessageSegment } from './model-prompts.ts'

/** Stable timestamps let a restarted run verify its previously summarized prefix. */
export function compactionSegments(messages: AgentMessage[], budget: number): AgentMessage[] {
  return messages.flatMap(message => {
    if (contextSize(message) <= budget) return [message]
    const serialized = message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult'
      ? serializeConversation([message]) : JSON.stringify(message)
    const characters = [...serialized]
    const segments: AgentMessage[] = []
    const size = Math.max(1, Math.floor(budget / 2))
    const total = Math.ceil(characters.length / size)
    for (let offset = 0; offset < characters.length; offset += size) {
      segments.push({ role: 'user', timestamp: typeof message.timestamp === 'number' ? message.timestamp : 0,
        content: historicalMessageSegment(Math.floor(offset / size) + 1, total, characters.slice(offset, offset + size).join('')) })
    }
    return segments
  })
}

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { SKILL_COMPACTION_REMINDER } from './model-prompts.ts'

/** A saved selection is not evidence that its full instructions survived summarization. */
export function retainSkillCompactionReminder(summary: string, messages: readonly AgentMessage[]): string {
  const removedSkill = messages.some(message => {
    if (message.role === 'toolResult') return !message.isError && (message.toolName === 'load_skill' || message.toolName === 'read_skill')
    if (message.role !== 'user') return false
    return typeof message.content === 'string' ? message.content.includes(SKILL_COMPACTION_REMINDER)
      : message.content.some(item => item.type === 'text' && item.text.includes(SKILL_COMPACTION_REMINDER))
  })
  return removedSkill && !summary.includes(SKILL_COMPACTION_REMINDER) ? `${summary}\n\n${SKILL_COMPACTION_REMINDER}` : summary
}

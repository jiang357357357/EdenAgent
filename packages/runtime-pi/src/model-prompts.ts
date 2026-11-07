export const MANUAL_COMPACTION_INSTRUCTION = '用中文总结当前目标、重要背景、已完成事项和接下来要做的事，保留继续对话所需的信息。'

export const AUTOMATIC_COMPACTION_INSTRUCTION = '用中文简洁总结当前目标、重要背景、进展和待办，保留继续对话所需的信息。'

export const SKILL_COMPACTION_REMINDER = '此前读取的技能说明可能已被压缩，继续依照技能操作前请按需使用 load_skill 重新读取完整说明。'

export function historicalMessageSegment(index: number, total: number, content: string): string {
  return `以下为历史消息片段 ${index}/${total}：\n${content}`
}

export function publicHandoffHistory(history: unknown): string {
  return PUBLIC_HANDOFF_HISTORY_PREFIX + JSON.stringify(history)
}

export function legacyConversationHistory(entry: unknown): string {
  return LEGACY_HISTORY_PREFIX + JSON.stringify(entry)
}

export const PUBLIC_HANDOFF_HISTORY_PREFIX = '以下是交接前的公开对话记录，按时间顺序保留说话者身份：\n'
export const LEGACY_HISTORY_PREFIX = '以下是迁移前的历史上下文，保留原说话者、结果与摘要：\n'

export const CLEARED_RUNTIME_CONTEXT = '当前运行资料已清空，此前的运行资料快照仅表示过去状态。'

export function runtimeContextSnapshot(sections: readonly { name: string; content: string }[]): string {
  return sections.length ? '以下为宿主提供的当前运行资料快照，仅供当前任务参考，不自动新增或延续任务。后发快照替代此前快照；当前状态同时以工具真实回执为准。\n\n'
    + sections.map(section => `[${section.name}]\n${section.content}`).join('\n\n') : CLEARED_RUNTIME_CONTEXT
}

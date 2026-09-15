export const MANUAL_COMPACTION_INSTRUCTION = '用中文总结当前目标、重要背景、已完成事项和接下来要做的事，保留继续对话所需的信息。'

export const AUTOMATIC_COMPACTION_INSTRUCTION = '用中文简洁总结当前目标、重要背景、进展和待办，保留继续对话所需的信息。'

export function historicalMessageSegment(index: number, total: number, content: string): string {
  return `以下为历史消息片段 ${index}/${total}：\n${content}`
}

export function publicHandoffHistory(history: unknown): string {
  return '以下是交接前的公开对话记录，按时间顺序保留说话者身份：\n' + JSON.stringify(history)
}

export function legacyConversationHistory(entry: unknown): string {
  return '以下是迁移前的历史上下文，保留原说话者、结果与摘要：\n' + JSON.stringify(entry)
}

import type { JsonValue } from '@eden/api'
import type { RuntimeTool } from './contracts.ts'

export function leadingSystemPrompt(base: string, tools: readonly RuntimeTool[], suffix?: string): string {
  return [base, ...tools.flatMap(tool => tool.promptHint ? [tool.promptHint] : []), ...(suffix ? [suffix] : [])].join('\n\n')
}

export function isLeadingSystemSource(source: JsonValue): boolean {
  return source !== null && typeof source === 'object' && !Array.isArray(source) && source.placement === 'leading'
}

/** Bind host source labels to the actual provider payload, including compaction requests. */
export function leadingSystemSources(payload: JsonValue | undefined, sources: readonly JsonValue[]): JsonValue[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.messages)) return []
  const first = payload.messages[0]
  if (!first || typeof first !== 'object' || Array.isArray(first)
    || !['system', 'developer'].includes(String(first.role)) || typeof first.content !== 'string') return []
  const text = first.content
  return sources.filter(source => source && typeof source === 'object' && !Array.isArray(source)
    && typeof source.content === 'string' && source.content.length > 0 && text.includes(source.content))
}

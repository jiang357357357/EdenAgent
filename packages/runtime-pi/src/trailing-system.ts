import type { JsonValue } from '@eden/api'

/** Use the public provider payload hook: SDK conversation messages do not support a system role. */
export function appendTrailingSystemMessage(payload: unknown, content: string | undefined): unknown {
  if (!content) return payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || !('messages' in payload) || !Array.isArray(payload.messages))
    throw new Error('模型请求缺少 messages，无法追加末尾 system 消息')
  return { ...payload, messages: [...payload.messages, { role: 'system', content }] }
}

export function isTrailingSystemSource(source: JsonValue): boolean {
  return source !== null && typeof source === 'object' && !Array.isArray(source) && source.placement === 'trailing'
}

export function hasTrailingSystemMessage(payload: JsonValue | undefined, content: string | undefined): boolean {
  if (!content || !payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.messages)) return false
  const last = payload.messages.at(-1)
  return !!last && typeof last === 'object' && !Array.isArray(last) && last.role === 'system' && last.content === content
}

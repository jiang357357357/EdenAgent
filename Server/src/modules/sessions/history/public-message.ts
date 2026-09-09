import type { JsonValue } from '@eden/api'

function object(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function publicMessage(payload: JsonValue): JsonValue {
  const wrapper = object(payload)
  const message = object(wrapper.message ?? payload)
  if (message.role !== 'user' && message.role !== 'assistant') return null
  const blocks = Array.isArray(message.content) ? message.content : []
  const text = typeof message.content === 'string' ? message.content : blocks.flatMap(block => {
    const value = object(block)
    return value.type === 'text' && typeof value.text === 'string' ? [value.text] : []
  }).join('\n')
  const actor = object(wrapper.actor).assistantID ?? wrapper.assistantID
  return { role: message.role, text, ...(typeof actor === 'string' || typeof actor === 'number' ? { assistantID: actor } : {}) }
}

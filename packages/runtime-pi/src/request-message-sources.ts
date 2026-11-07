import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { JsonValue } from '@eden/api'
import { isRuntimeContextSnapshot } from './runtime-context-snapshots.ts'

function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.flatMap(part => part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n')
}

/** Provenance is inspection metadata; it is never added to provider messages. */
export function requestMessageSources(payload: JsonValue | undefined, context: readonly AgentMessage[], memory?: string) {
  const raw = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const messages = Array.isArray(raw.messages) ? raw.messages : []
  const input = context.findLast(message => message.role === 'user')
  const inputText = input && input.role === 'user' ? textContent(input.content) : undefined
  const inputIndex = inputText === undefined ? -1 : messages.findLastIndex(message =>
    message && typeof message === 'object' && !Array.isArray(message) && message.role === 'user'
    && textContent(message.content) === inputText)
  const snapshots = new Set(context.filter(isRuntimeContextSnapshot).map(message =>
    message.role === 'custom' ? textContent(message.content) : ''))
  return messages.flatMap((message, index) => {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.role !== 'user') return []
    if (index === inputIndex) return [{ index, kind: 'input' }]
    if (memory && textContent(message.content) === memory) return [{ index, kind: 'memory' }]
    return snapshots.has(textContent(message.content)) ? [{ index, kind: 'runtime-context' }] : []
  })
}

import type { JsonValue } from './json.ts'

const treeTypes = new Set(['message', 'custom_message', 'compaction', 'branch_summary', 'custom', 'model_change',
  'thinking_level_change', 'active_tools_change', 'label', 'session_info', 'leaf'])

/** Opaque SDK continuity data is never business text and must be replayed byte for byte. */
export function isRuntimeProtocolField(key: string, container?: Record<string, JsonValue>): boolean {
  if (['thinkingSignature', 'textSignature', 'thoughtSignature', 'toolCallId'].includes(key)) return true
  if (container?.type === 'toolCall' && ['id', 'name'].includes(key)) return true
  if (treeTypes.has(String(container?.type)) && typeof container?.id === 'string'
    && Object.hasOwn(container, 'parentId') && ['id', 'parentId', 'timestamp'].includes(key)) return true
  return typeof container?.role === 'string' && ['role', 'toolName', 'api', 'provider', 'model', 'stopReason', 'timestamp'].includes(key)
}

/** A signed thinking block's body and signature form a single provider protocol value. */
export function isSignedThinking(value: Record<string, JsonValue>): boolean {
  return value.type === 'thinking' && (value.redacted === true
    || (typeof value.thinkingSignature === 'string' && value.thinkingSignature.length > 0))
}

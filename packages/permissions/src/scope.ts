import { createHash } from 'node:crypto'
import type { JsonValue } from '@eden/api'

function canonical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key]!)]))
  return value
}

/** Grants are realm-local, session-local, and bound to exact operation details. */
export function permissionScope(sessionId: string, capability: string, resource: string, details: JsonValue): string {
  return createHash('sha256').update(JSON.stringify(canonical({ sessionId, capability, resource, details }))).digest('hex')
}

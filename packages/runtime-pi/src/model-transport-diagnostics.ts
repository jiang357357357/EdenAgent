import { AsyncLocalStorage } from 'node:async_hooks'
import { channel } from 'node:diagnostics_channel'
import type { JsonValue } from '@eden/api'

export interface TransportDiagnostics { causes: JsonValue[]; secrets: string[]; status?: number }
const active = new AsyncLocalStorage<TransportDiagnostics>()

export function safeTransportError(error: unknown, secrets: string[] = [], depth = 0): JsonValue {
  if (depth > 4 || !error || typeof error !== 'object') return null
  const value = error as Record<string, unknown>
  const result: Record<string, JsonValue> = {}
  for (const key of ['name', 'code', 'syscall', 'message']) {
    if (typeof value[key] !== 'string') continue
    let text = value[key] as string
    for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]')
    text = text.replace(/https?:\/\/[^\s)'"<>]+/g, url => { try { return new URL(url).origin } catch { return '[url]' } })
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    result[key] = text.slice(0, 800)
  }
  if (value.cause) result.cause = safeTransportError(value.cause, secrets, depth + 1)
  if (Array.isArray(value.errors)) result.errors = value.errors.slice(0, 4).map(item => safeTransportError(item, secrets, depth + 1))
  return result
}

channel('undici:request:headers').subscribe(message => {
  const diagnostics = active.getStore()
  if (diagnostics) diagnostics.status = (message as { response: { statusCode: number } }).response.statusCode
})

channel('undici:request:error').subscribe(message => {
  const diagnostics = active.getStore()
  if (!diagnostics || diagnostics.causes.length >= 4) return
  diagnostics.causes.push(safeTransportError((message as { error?: unknown }).error, diagnostics.secrets))
})

export function observeTransport<T>(diagnostics: TransportDiagnostics, start: () => T): T {
  return active.run(diagnostics, start)
}

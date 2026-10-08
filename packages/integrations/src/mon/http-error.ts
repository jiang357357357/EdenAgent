import { OperationFailure } from '@eden/api'
import type { JsonValue } from '@eden/api'

const sensitiveKeys = /token|secret|password|authorization|api[_-]?key|cookie/i
function redact(raw: unknown, depth = 0): JsonValue {
  if (depth > 6) return '[depth limit]'
  if (Array.isArray(raw)) return raw.slice(0, 32).map(value => redact(value, depth + 1))
  if (raw && typeof raw === 'object') return Object.fromEntries(Object.entries(raw).slice(0, 64)
    .map(([key, value]) => [key, sensitiveKeys.test(key) ? '[redacted]' : redact(value, depth + 1)]))
  if (typeof raw === 'string') return raw.slice(0, 4096)
  return typeof raw === 'boolean' || typeof raw === 'number' || raw === null ? raw : String(raw)
}
function boundedReason(raw: unknown): JsonValue | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const fields = redact(raw)
  const serialized = JSON.stringify(fields)
  if (serialized.length > 4096) return { message: 'Core error details exceed the diagnostic limit' }
  return fields as JsonValue
}

export class MonHttpError extends OperationFailure {
  readonly response: JsonValue | undefined
  constructor(readonly status: number, endpoint = '', raw?: unknown) {
    const response = boundedReason(raw)
    const knownFailure = Boolean(response && typeof response === 'object' && !Array.isArray(response) && response.success === false)
    const label = status === 401 || status === 403 ? 'Mon authentication rejected' : 'Mon request failed'
    const reason = response ? `: ${JSON.stringify(response)}` : ''
    super(`${label} (${status})${endpoint ? ` ${endpoint}` : ''}${reason}`, {
      kind: 'core_http', status, endpoint, outcome: status < 500 || knownFailure ? 'failed' : 'unknown',
      retryable: [408, 429, 502, 503, 504].includes(status) && (!knownFailure || status === 503),
      ...(response ? { reason: response } : {}),
    })
    this.name = 'MonHttpError'
    this.response = response
  }
}

/** Error responses are bounded separately from the successful catalogue payload. */
export async function readMonHttpError(response: Response, endpoint: string): Promise<MonHttpError> {
  const reader = response.body?.getReader()
  if (!reader) return new MonHttpError(response.status, endpoint)
  const chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 65536) break
      chunks.push(value)
    }
    let raw: unknown
    if (size <= 65536) { try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {} }
    return new MonHttpError(response.status, endpoint, raw)
  } catch { return new MonHttpError(response.status, endpoint) }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}

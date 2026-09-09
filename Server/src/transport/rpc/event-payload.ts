import { createHash } from 'node:crypto'
import type { JsonValue } from '@eden/api'

function imageSummary(data: string) {
  const bytes = Buffer.from(data, 'base64')
  return { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length }
}

/** Internal audit keeps exact requests; the wire projection never repeats inline image bytes. */
export function eventPayload(value: JsonValue): JsonValue {
  if (typeof value === 'string') return value.replace(/data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g, (_match, mime: string, data: string) => {
    const summary = imageSummary(data)
    return `[inline ${mime} omitted; sha256=${summary.sha256}; bytes=${summary.byteLength}]`
  })
  if (Array.isArray(value)) return value.map(eventPayload)
  if (!value || typeof value !== 'object') return value
  if (value.type === 'image' && typeof value.data === 'string') {
    return { type: 'image_omitted', mimeType: typeof value.mimeType === 'string' ? value.mimeType : 'application/octet-stream', ...imageSummary(value.data) }
  }
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, eventPayload(nested)]))
}

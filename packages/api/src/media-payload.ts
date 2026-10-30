import type { JsonValue } from './json.ts'

const mediaTypes = new Set(['image', 'audio', 'file', 'video', 'input_image', 'input_audio', 'image_url'])
const payloadKeys = new Set(['data', 'blob', 'bytes', 'base64', 'file_data', 'audio_data'])

/** Binary payloads are transport values, never prose to rewrite. Metadata text remains visitable. */
export function isMediaPayloadField(key: string, container: Record<string, JsonValue>): boolean {
  if (typeof container[key] !== 'string') return false
  if (/(?:^|_)base64$/i.test(key) || key === 'file_data') return true
  const mime = container.mimeType ?? container.mime_type ?? container.mime
  const media = mediaTypes.has(String(container.type)) || typeof mime === 'string'
    && /^(?:image|audio|video|application)\//i.test(mime)
    || ['wav', 'mp3', 'pcm16'].includes(String(container.format))
  return Boolean(media && (payloadKeys.has(key) || ['mimeType', 'mime_type', 'mime', 'encoding', 'format', 'type'].includes(key)))
}

/** Preserve inline payload spans even when a data URI is embedded in ordinary prose. */
export function mapTextOutsideMedia(text: string, project: (text: string) => string): string {
  const pattern = /(?:data:[^\s,;"'<>]+(?:;[^\s,"'<>]*)?;base64,|base64:\/\/)[A-Za-z0-9+/=]+/gi
  let result = '', cursor = 0
  for (const match of text.matchAll(pattern)) {
    result += project(text.slice(cursor, match.index)) + match[0]
    cursor = match.index + match[0].length
  }
  return result + project(text.slice(cursor))
}

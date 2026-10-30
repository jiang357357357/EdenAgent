import type { JsonValue } from '@eden/api'
import { validCheckpointImage } from './checkpoint-images.ts'

/** Last local check after payload hooks, before any provider HTTP request is admitted. */
export function assertRequestImages(payload: JsonValue): void {
  const object = (value: JsonValue | undefined) => value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  const messages = object(payload)?.messages
  if (!Array.isArray(messages)) return
  for (const message of messages) {
    const content = object(message)?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const part = object(block)
      if (part?.type !== 'image_url') continue
      const url = typeof part.image_url === 'string' ? part.image_url : object(part.image_url)?.url
      if (typeof url !== 'string' || !url.startsWith('data:')) continue
      const match = /^data:([^;,]+);base64,(.*)$/s.exec(url)
      if (!match || !validCheckpointImage({ type: 'image', mimeType: match[1]!, data: match[2]! }))
        throw new Error('图片数据损坏，请从原始附件恢复或重新提供图片；请求未发送')
    }
  }
}

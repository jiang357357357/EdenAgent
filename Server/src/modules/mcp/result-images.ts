import type { JsonValue } from '@eden/api'
import type { RuntimeImage } from '@eden/runtime-pi'
export async function mcpResultImages(result: JsonValue, signal: AbortSignal): Promise<RuntimeImage[]> {
  signal.throwIfAborted()
  const values = resultContent(result)
  const images: RuntimeImage[] = []
  let total = 0
  for (const item of values) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const resource = item.resource && typeof item.resource === 'object' && !Array.isArray(item.resource) ? item.resource : item
    const mime = resource.mimeType
    if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/gif' && mime !== 'image/webp') continue
    const { bytes, valid, data } = decodeMcpImage(resource, mime)
    total += bytes.length
    if (!valid || total > 8 * 1024 * 1024 || images.length >= 8) throw new Error('MCP image content or size is invalid')
    images.push({ type: 'image', mimeType: mime, data })
  }
  return images
}

function decodeMcpImage(resource: { [key: string]: JsonValue }, mime: string) {
  const data = typeof resource.data === 'string' ? resource.data : resource.blob
  if (typeof data !== 'string' || data.length > 8 * 1024 * 1024 || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Invalid MCP image encoding')
  const bytes = Buffer.from(data, 'base64')
  if (bytes.toString('base64') !== data) throw new Error('Noncanonical MCP image encoding')
  const valid = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mime === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  return { bytes, valid, data }
}

function resultContent(result: JsonValue): JsonValue[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return []
  return Array.isArray(result.content) ? result.content : Array.isArray(result.contents) ? result.contents : []
}

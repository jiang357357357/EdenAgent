import { jsonValue, type JsonValue } from '@eden/api'

/** Stream bounded SSE events without buffering an entire event stream. */
export async function* mcpHttpMessages(response: Response): AsyncGenerator<JsonValue> {
  if (!response.body) throw new Error('MCP HTTP response has no body')
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (type !== 'application/json' && type !== 'text/event-stream') {
    await response.body.cancel(); throw new Error('MCP response has an unsupported media type')
  }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = '', data: string[] = [], size = 0, total = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.length
      if (total > 16 * 1024 * 1024) throw new Error('MCP response exceeds stream budget')
      pending += decoder.decode(chunk.value, { stream: true })
      if (Buffer.byteLength(pending) > 8 * 1024 * 1024) throw new Error('MCP response frame exceeds limit')
      if (type === 'application/json') continue
      let boundary: number
      while ((boundary = pending.search(/[\r\n]/)) >= 0) {
        if (pending[boundary] === '\r' && boundary === pending.length - 1) break
        const line = pending.slice(0, boundary)
        const width = pending[boundary] === '\r' && pending[boundary + 1] === '\n' ? 2 : 1
        pending = pending.slice(boundary + width)
        if (!line) {
          if (data.length) yield jsonValue.parse(JSON.parse(data.join('\n')))
          data = []; size = 0
        } else if (line.startsWith('data:')) {
          const value = line.slice(5).replace(/^ /, '')
          size += Buffer.byteLength(value) + 1
          if (size > 8 * 1024 * 1024) throw new Error('MCP SSE event exceeds limit')
          data.push(value)
        }
      }
    }
    pending += decoder.decode()
    if (type === 'application/json') yield jsonValue.parse(JSON.parse(pending))
    else if (data.length || pending.trim()) throw new Error('MCP SSE response ended mid-event')
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

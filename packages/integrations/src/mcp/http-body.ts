import { jsonValue, type JsonValue } from '@eden/api'

/** Stream bounded SSE events without buffering an entire event stream. */
export async function* mcpHttpMessages(response: Response): AsyncGenerator<JsonValue> {
  if (!response.body) throw new Error('MCP HTTP response has no body')
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (type !== 'application/json' && type !== 'text/event-stream') {
    await response.body.cancel(); throw new Error('MCP response has an unsupported media type')
  }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  const state: SseState = { pending: '', data: [], size: 0 }
  let total = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      total += chunk.value.length
      if (total > 16 * 1024 * 1024) throw new Error('MCP response exceeds stream budget')
      state.pending += decoder.decode(chunk.value, { stream: true })
      if (Buffer.byteLength(state.pending) > 8 * 1024 * 1024) throw new Error('MCP response frame exceeds limit')
      if (type === 'application/json') continue
      yield* consumeSseLines(state)
    }
    state.pending += decoder.decode()
    if (type === 'application/json') yield jsonValue.parse(JSON.parse(state.pending))
    else if (state.data.length || state.pending.trim()) throw new Error('MCP SSE response ended mid-event')
  } finally { await reader.cancel().catch(() => { }); reader.releaseLock() }
}

interface SseState { pending: string; data: string[]; size: number }

function* consumeSseLines(state: SseState): Generator<JsonValue> {
  let boundary: number
  while ((boundary = state.pending.search(/[\r\n]/)) >= 0) {
    if (state.pending[boundary] === '\r' && boundary === state.pending.length - 1) break
    const line = state.pending.slice(0, boundary)
    const width = state.pending[boundary] === '\r' && state.pending[boundary + 1] === '\n' ? 2 : 1
    state.pending = state.pending.slice(boundary + width)
    if (!line) {
      if (state.data.length) yield jsonValue.parse(JSON.parse(state.data.join('\n')))
      state.data = []; state.size = 0
    } else if (line.startsWith('data:')) {
      const value = line.slice(5).replace(/^ /, '')
      state.size += Buffer.byteLength(value) + 1
      if (state.size > 8 * 1024 * 1024) throw new Error('MCP SSE event exceeds limit')
      state.data.push(value)
    }
  }
}

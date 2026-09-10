import type { Readable, Writable } from 'node:stream'
import { jsonValue, type JsonValue } from '@eden/api'

type Pending = { resolve(value: JsonValue): void; reject(error: Error): void; cleanup(): void }
export interface McpChannel {
  request(method: string, params: JsonValue, signal: AbortSignal, timeoutMs?: number): Promise<JsonValue>
  notify(method: string, params?: JsonValue): void | Promise<void>
  close(): void
}
export class McpRemoteError extends Error {
  constructor(readonly code: number) { super(`MCP request failed (${code})`) }

}
/** MCP stdio uses newline-delimited JSON, not the native connector length-prefixed protocol. */
export class McpStdioChannel implements McpChannel {
  private readonly pending = new Map<number, Pending>()
  private next = 1
  private buffer = Buffer.alloc(0)
  private closed = false
  constructor(private readonly input: Writable, private readonly output: Readable, private readonly terminate: () => void,
    private readonly onNotification: (method: string, params: JsonValue) => void = () => { }) {
    output.on('data', this.receive)
    output.on('end', this.end)
    output.on('error', this.end)
    input.on('error', this.end)
  }
  request(method: string, params: JsonValue, signal: AbortSignal, timeoutMs = 120000): Promise<JsonValue> {
    signal.throwIfAborted()
    if (this.closed || this.pending.size >= 32) return Promise.reject(new Error('MCP connection unavailable or busy'))
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) return Promise.reject(new Error('Invalid MCP deadline'))
    const id = this.next++
    return new Promise((resolve, reject) => {
      const abort = () => this.fail(new Error('MCP request cancelled; remote effects may be unknown'))
      const timer = setTimeout(() => this.fail(new Error('MCP request timed out; remote effects may be unknown')), timeoutMs)
      timer.unref()
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
      this.pending.set(id, { resolve, reject, cleanup })
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      try { this.write({ jsonrpc: '2.0', id, method, params }) } catch { this.fail(new Error('MCP request could not be written')) }
    })
  }
  notify(method: string, params: JsonValue = {}) { this.write({ jsonrpc: '2.0', method, params }) }
  close() { this.fail(new Error('MCP connection closed')) }
  private write(message: JsonValue) {
    if (this.closed) throw new Error('MCP connection closed')
    const bytes = Buffer.from(JSON.stringify(message) + '\n')
    if (bytes.length > 8 * 1024 * 1024 || this.input.writableLength + bytes.length > 8 * 1024 * 1024) throw new Error('MCP output limit exceeded')
    this.input.write(bytes)
  }
  private readonly end = () => this.fail(new Error('MCP stream ended'))
  private readonly receive = (chunk: Buffer) => {
    try {
      // Process each line as it arrives, retaining at most one bounded incomplete frame.
      let offset = 0
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset), end = newline < 0 ? chunk.length : newline
        if (this.buffer.length + end - offset > 8 * 1024 * 1024) throw new Error('MCP frame limit exceeded')
        this.buffer = Buffer.concat([this.buffer, chunk.subarray(offset, end)])
        if (newline < 0) break
        const line = this.buffer; this.buffer = Buffer.alloc(0); offset = newline + 1
        if (line.length) this.message(jsonValue.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))))
        if (this.closed) return
      }
    } catch { this.fail(new Error('Invalid MCP stdio message')) }
  }
  private message(value: JsonValue) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.jsonrpc !== '2.0') throw new Error('Invalid MCP envelope')
    if (typeof value.method === 'string') {
      this.receiveServerRequest(value)
      return
    }
    const pending = typeof value.id === 'number' ? this.pending.get(value.id) : undefined
    if (!pending || Object.hasOwn(value, 'error') === Object.hasOwn(value, 'result')) throw new Error('Unexpected MCP response')
    if (Object.hasOwn(value, 'error')) {
      const error = value.error
      if (!error || typeof error !== 'object' || Array.isArray(error) || typeof error.code !== 'number' || !Number.isInteger(error.code)) throw new Error('Invalid MCP error')
      this.pending.delete(value.id as number); pending.cleanup(); pending.reject(new McpRemoteError(error.code))
    } else {
      this.pending.delete(value.id as number); pending.cleanup(); pending.resolve(value.result!)
    }

  }
  private fail(error: Error) {
    if (this.closed) return
    this.closed = true; this.buffer = Buffer.alloc(0)
    this.output.removeListener('data', this.receive)
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error) }
    this.pending.clear()
    try { this.terminate() } catch { process.stderr.write('MCP transport termination failed\n') }
  }
  private receiveServerRequest(value: Record<string, JsonValue>) {

    if (Object.hasOwn(value, 'id')) {
      if (typeof value.id !== 'string' && typeof value.id !== 'number') throw new Error('Invalid MCP request ID')
      this.write(value.method === 'ping' ? { jsonrpc: '2.0', id: value.id, result: {} }
        : { jsonrpc: '2.0', id: value.id, error: { code: -32601, message: 'Client capability is not available' } })
    } else this.onNotification(String(value.method), value.params ?? {})

  }
}

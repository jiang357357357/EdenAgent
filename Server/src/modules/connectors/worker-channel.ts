import { z } from 'zod'
import type { Readable, Writable } from 'node:stream'
import { jsonValue } from '@eden/api'
import type { JsonValue } from '@eden/api'
import { encodeWorkerFrame, WorkerFrameReader, maxWorkerFrame } from './worker-frames.ts'
const notification = z.object({ method: z.enum(['event.publish', 'worker.status', 'worker.log']), params: jsonValue.default(null) }).strict()
const response = z.object({ id: z.number().int().positive().safe(), result: jsonValue.optional(),
  error: z.object({ code: z.string().max(256), message: z.string().max(4096), data: jsonValue.optional() }).strict().optional() }).strict()
export class WorkerRemoteError extends Error { constructor(readonly code: string) { super(`Connector worker rejected request (${code})`) } }
export class WorkerChannel {
  private readonly reader = new WorkerFrameReader()
  private sequence = 0
  private failure: Error | undefined
  private readonly pending = new Map<number, { resolve(value: JsonValue): void; reject(error: Error): void; cleanup(): void }>()
  constructor(private readonly input: Writable, private readonly output: Readable,
    private readonly notify: (method: string, params: JsonValue) => void, private readonly onFailure: (error: Error) => void) {
    output.on('data', this.onData); output.on('end', this.onEnd); output.on('error', this.onError); input.on('error', this.onError)
  }
  request(method: 'initialize' | 'health' | 'query' | 'execute' | 'disconnect' | 'shutdown', params: JsonValue,
    signal: AbortSignal, timeoutMs = 30000): Promise<JsonValue> {
    signal.throwIfAborted()
    if (this.failure) return Promise.reject(this.failure)
    if (this.pending.size >= 32 || this.input.writableLength > maxWorkerFrame) return Promise.reject(new Error('Connector request queue is full'))
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error('Invalid connector request timeout')
    const id = ++this.sequence
    if (!Number.isSafeInteger(id)) throw new Error('Connector request ID exhausted')
    const frame = encodeWorkerFrame({ id, method, params })
    return new Promise((resolve, reject) => {
      // No protocol cancellation exists. Stop the channel on cancellation/timeout; do not claim remote work was undone.
      const abort = () => this.fail(new Error('Connector request cancelled; remote outcome may be unknown'))
      const timer = setTimeout(() => this.fail(new Error('Connector request timed out; remote outcome may be unknown')), timeoutMs)
      timer.unref()
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort) }
      this.pending.set(id, { resolve, reject, cleanup }); signal.addEventListener('abort', abort, { once: true })
      try { this.input.write(frame, error => { if (error) this.fail(new Error('Connector transport write failed')) }) }
      catch { this.fail(new Error('Connector transport write failed')) }
      if (signal.aborted) abort()
    })
  }
  close() { this.fail(new Error('Connector channel closed')) }
  private readonly onData = (chunk: Buffer) => {
    if (this.failure) return
    try { this.reader.push(chunk, value => this.receive(value)) } catch { this.fail(new Error('Invalid connector worker frame')) }
  }
  private readonly onEnd = () => {
    try { this.reader.end(); this.fail(new Error('Connector worker stream ended')) }
    catch { this.fail(new Error('Connector worker stream was truncated')) }
  }
  private readonly onError = () => this.fail(new Error('Connector transport failed'))
  private receive(value: JsonValue) {
    if (this.failure) return
    if (value && typeof value === 'object' && !Array.isArray(value) && 'method' in value) {
      const item = notification.parse(value); this.notify(item.method, item.params); return
    }
    const item = response.parse(value)
    if ((item.error !== undefined) === ('result' in item)) throw new Error('Connector response must contain exactly one result or error')
    const waiter = this.pending.get(item.id)
    if (!waiter) throw new Error('Unknown connector response ID')
    this.pending.delete(item.id); waiter.cleanup()
    if (item.error) waiter.reject(new WorkerRemoteError(item.error.code))
    else waiter.resolve(item.result!)
  }
  private fail(error: Error) {
    if (this.failure) return
    this.failure = error
    this.output.off('data', this.onData); this.output.off('end', this.onEnd)
    for (const waiter of this.pending.values()) { waiter.cleanup(); waiter.reject(error) }
    this.pending.clear(); this.input.destroy(); this.output.destroy()
    this.onFailure(error)
  }
}

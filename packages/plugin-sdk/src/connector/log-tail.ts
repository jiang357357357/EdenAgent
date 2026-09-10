import { open, type FileHandle } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

export interface LogBatch { lines: string[]; initial: boolean; complete: boolean }
/** Bounded incremental reads, partial UTF-8 lines, truncation and same-size rewrite detection. */
export async function followLog(file: string, signal: AbortSignal, receive: (batch: LogBatch) => void, pollMs = 500) {
  let cursor = 0, guard: Buffer = Buffer.alloc(0), pending: Buffer = Buffer.alloc(0), initial = true
  while (!signal.aborted) {
    let handle: FileHandle | undefined
    try {
      handle = await open(file, 'r')
      const stat = await handle.stat()
      if (!stat.isFile()) throw new Error('Connector log is not a regular file')
      const actual = Buffer.alloc(guard.length)
      if (guard.length) await handle.read(actual, 0, actual.length, cursor - guard.length)
      if (stat.size < cursor || !guard.equals(actual)) { cursor = 0; guard = Buffer.alloc(0); pending = Buffer.alloc(0); initial = true }
      const bytes = Buffer.alloc(Math.min(256 * 1024, Math.max(0, stat.size - cursor)))
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, cursor)
      cursor += bytesRead
      const chunk = bytes.subarray(0, bytesRead)
      guard = Buffer.concat([guard, chunk]).subarray(-64)
      pending = Buffer.concat([pending, chunk])
      const end = pending.lastIndexOf(10), lines = end < 0 ? [] : pending.subarray(0, end).toString('utf8').split('\n').map(line => line.replace(/\r$/, ''))
      pending = pending.subarray(end + 1)
      if (pending.length > 1024 * 1024) throw new Error('Connector log line exceeds limit')
      const complete = cursor >= stat.size
      receive({ lines, initial, complete })
      if (complete) initial = false
      if (!complete) continue
    } catch (error) {
      if (!isMissing(error)) throw error
    } finally { await handle?.close() }
    try { await delay(pollMs, undefined, { signal }) } catch (error) { if (!signal.aborted) throw error }
  }
}

function isMissing(error: unknown) { return error instanceof Error && 'code' in error && error.code === 'ENOENT' }

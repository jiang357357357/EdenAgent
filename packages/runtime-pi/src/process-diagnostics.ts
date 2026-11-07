import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'

export interface RuntimeMemory {
  rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number; heapLimit: number
}
export interface RuntimeProcessDiagnostic {
  event: string; sessionId: string; childPid: number | null; maxOldSpaceMb: number
  elapsedMs: number; heartbeatAgeMs: number | null; memory?: RuntimeMemory
  lastMethod?: string; lastTool?: { name: string; callId: string }
  exitCode?: number | null; signal?: string | null; reason?: string; kind?: string
  stdoutTail?: string; stderrTail?: string; stdoutBytes?: number; stderrBytes?: number
}
const tailLimit = 16 * 1024

class OutputTail {
  private readonly decoder = new StringDecoder('utf8')
  text = ''
  bytes = 0
  attach(stream: Readable) {
    stream.on('data', (chunk: Buffer) => {
      this.bytes += chunk.length
      this.text = (this.text + this.decoder.write(chunk)).slice(-tailLimit)
    })
    stream.on('end', () => { this.text = (this.text + this.decoder.end()).slice(-tailLimit) })
    stream.on('error', (error: Error) => { this.text = (this.text + `\n[pipe read failed: ${error.message}]`).slice(-tailLimit) })
  }
}

/** Drain both pipes continuously; retain only a bounded tail, never prompts or IPC payloads. */
export class ProcessDiagnostics {
  private readonly startedAt = performance.now()
  private heartbeatAt?: number
  private memory?: RuntimeMemory
  private lastMethod?: string
  private lastTool?: { name: string; callId: string }
  private readonly stdout = new OutputTail()
  private readonly stderr = new OutputTail()
  constructor(private readonly sessionId: string, private readonly childPid: number | undefined, private readonly maxOldSpaceMb: number,
    private readonly sink?: (record: RuntimeProcessDiagnostic) => void) {}
  attach(stdout: Readable, stderr: Readable) { this.stdout.attach(stdout); this.stderr.attach(stderr) }
  activity(memory?: RuntimeMemory) { this.heartbeatAt = performance.now(); if (memory) this.memory = memory }
  method(name: string) { this.lastMethod = name }
  tool(name: string | undefined, callId: string) { if (name) this.lastTool = { name, callId: callId.slice(0, 256) } }
  get outOfMemory() { return /heap out of memory|reached heap limit|FatalProcessOutOfMemory|allocation failed[^\n]*heap/i.test(this.stderr.text) }
  record(event: string, extra: Partial<RuntimeProcessDiagnostic> = {}): RuntimeProcessDiagnostic {
    return { event, sessionId: this.sessionId, childPid: this.childPid ?? null, maxOldSpaceMb: this.maxOldSpaceMb,
      elapsedMs: Math.round(performance.now() - this.startedAt), heartbeatAgeMs: this.heartbeatAt === undefined ? null : Math.round(performance.now() - this.heartbeatAt),
      ...(this.memory ? { memory: this.memory } : {}), ...(this.lastMethod ? { lastMethod: this.lastMethod } : {}),
      ...(this.lastTool ? { lastTool: this.lastTool } : {}), ...extra }
  }
  emit(event: string, extra: Partial<RuntimeProcessDiagnostic> = {}) {
    const record = this.record(event, extra)
    try { if (this.sink) { this.sink(record); return } } catch { /* A diagnostic failure cannot replace the runtime outcome. */ }
    if (event === 'runtime.process.started' || event === 'runtime.process.disposed') return
    try { process.stderr.write(JSON.stringify(record) + '\n') } catch { /* The parent logger may already be closed. */ }
  }
  closed(exitCode: number | null, signal: string | null, reason: string, kind: string) {
    this.emit(kind === 'disposed' ? 'runtime.process.disposed' : kind === 'cancelled' ? 'runtime.process.cancelled' : 'runtime.process.failed', {
      exitCode, signal, reason, kind: this.outOfMemory ? 'out_of_memory' : kind,
      stdoutTail: this.stdout.text, stderrTail: this.stderr.text, stdoutBytes: this.stdout.bytes, stderrBytes: this.stderr.bytes,
    })
  }
}

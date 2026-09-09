import type { MemoryExtractionRepository, MemoryExtractionJob } from './extraction-repository.ts'
import type { MemoryExtractionRunner } from './extraction-runner.ts'

/** One keyset scan per wake; unresolved bindings remain queued until a later explicit wake. */
export class MemoryExtractionQueue {
  private cursor: string | null = null
  private readonly active = new Map<string, { sessionId: string; controller: AbortController; task: Promise<void> }>()
  private readonly controller = new AbortController()
  private scheduled: NodeJS.Immediate | undefined
  private closed = false
  private failure: unknown

  constructor(private readonly jobs: Pick<MemoryExtractionRepository, 'queued'>,
    private readonly runner: Pick<MemoryExtractionRunner, 'run' | 'close'>,
    private readonly report: (id: string, error: unknown) => void, private readonly concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Invalid extraction queue concurrency')
  }

  wake(): void {
    if (this.closed) return
    this.cursor = '0'
    this.schedule()
  }

  cancelSession(sessionId: string): void {
    for (const item of this.active.values()) {
      if (item.sessionId === sessionId) item.controller.abort(new Error('Memory extraction session is closed'))
    }
  }

  resume(job: MemoryExtractionJob): void {
    if (this.closed) throw new Error('Memory extraction queue is closed')
    if (this.active.has(job.id)) return
    if (this.active.size >= this.concurrency) throw new Error('Memory extraction queue is busy')
    this.launch(job)
  }

  isRunning(id: string): boolean { return this.active.has(id) }

  private schedule(): void {
    if (this.closed || this.scheduled || this.cursor === null || this.active.size >= this.concurrency) return
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined
      try { this.pump() } catch (error) { this.stop(error) }
    })
  }

  private pump(): void {
    if (this.closed || this.cursor === null || this.active.size >= this.concurrency) return
    const page = this.jobs.queued(this.cursor, 1)
    this.cursor = page.nextCursor
    for (const job of page.items) {
      if (this.active.has(job.id)) continue
      this.launch(job)
    }
    this.schedule()
  }

  private launch(job: MemoryExtractionJob): void {
    const controller = new AbortController()
    const signal = AbortSignal.any([this.controller.signal, controller.signal])
    const task = Promise.resolve().then(() => this.runner.run(job.id, signal)).then(() => {}, error => {
      if (!this.closed) {
        try { this.report(job.id, error) } catch (failure) { this.stop(failure) }
      }
    }).finally(() => { this.active.delete(job.id); this.schedule() })
    this.active.set(job.id, { sessionId: job.sessionId, controller, task })
  }

  private stop(error: unknown): void {
    this.failure = error
    this.closed = true
    this.controller.abort(error)
  }

  get fault(): unknown { return this.failure }
  get runningCount(): number { return this.active.size }

  async close(): Promise<void> {
    this.closed = true
    if (this.scheduled) clearImmediate(this.scheduled)
    this.scheduled = undefined
    this.controller.abort(new Error('Memory extraction queue is closing'))
    const results = await Promise.allSettled([this.runner.close(), Promise.all([...this.active.values()].map(item => item.task))])
    if (this.failure !== undefined) throw this.failure
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (errors.length) throw new AggregateError(errors, 'Memory extraction queue could not close cleanly')
  }
}

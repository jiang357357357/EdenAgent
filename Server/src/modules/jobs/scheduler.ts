import type { JobInfo } from '@eden/api'
import type { JobRepository } from './repository.ts'

export class DeferredJob extends Error {}
export type JobHandler = (job: JobInfo) => void

export class JobScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined
  private closed = false
  private started = false
  private failure: string | undefined
  constructor(private readonly repository: JobRepository, private readonly handlers: Record<string, JobHandler>) {}
  get fault(): string | undefined { return this.failure }

  start(): void {
    if (this.started || this.closed) return
    this.repository.recover()
    this.started = true
    this.schedule(0)
  }

  close(): void { this.closed = true; clearTimeout(this.timer) }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => this.pump(), delay)
    this.timer.unref()
  }

  private pump(): void {
    if (this.closed) return
    try {
      this.repository.settleInputs()
      for (let index = 0; index < 32 && !this.closed; index++) {
        const job = this.repository.claim()
        if (!job) break
        try {
          const handler = Object.hasOwn(this.handlers, job.kind) ? this.handlers[job.kind] : undefined
          if (!handler) throw new Error(`No dispatcher registered for job kind: ${job.kind}`)
          handler(job)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (error instanceof DeferredJob) this.repository.defer(job.id, message)
          else this.repository.fail(job.id, message)
        }
      }
      this.schedule(1000)
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error)
      this.closed = true
      process.stderr.write(`Job scheduler stopped: ${this.failure}\n`)
    }
  }
}

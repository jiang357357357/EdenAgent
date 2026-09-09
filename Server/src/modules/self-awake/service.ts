import { selfAwakeDecisionSchema, toJson } from '@eden/api'
import type { JobInfo } from '@eden/api'
import { DeferredJob } from '../jobs/index.ts'
import type { JobRepository } from '../jobs/index.ts'
import type { SessionService } from '../sessions/index.ts'
import { SelfAwakeRepository } from './repository.ts'
import { selfAwakePrompt, selfAwakeRequest } from './prompt.ts'
import { SelfAwakeJobRecovery } from './job-recovery.ts'

export class SelfAwakeService {
  readonly recovery: SelfAwakeJobRecovery
  private unsubscribe: (() => void) | undefined
  private closed = false
  private queued = false
  private error: string | undefined
  constructor(readonly repository: SelfAwakeRepository, private readonly jobs: JobRepository, private readonly sessions: SessionService, private readonly onDecision: () => void = () => {}) {
    this.recovery = new SelfAwakeJobRecovery(repository.database, jobs, sessions)
  }
  get fault(): string | undefined { return this.error }

  start(): void {
    if (this.unsubscribe || this.closed) return
    this.unsubscribe = this.sessions.repository.events.subscribe(event => {
      if (event.kind.startsWith('input.') || event.kind.startsWith('turn.')) this.wake()
    })
    this.wake()
  }
  close(): void { this.closed = true; this.unsubscribe?.(); this.unsubscribe = undefined }

  dispatch(job: JobInfo): void {
    if (this.closed) throw new Error('Self-awake service is closed')
    if (!job.sessionId) throw new Error('Self-awake job requires a session')
    const session = this.sessions.repository.read(job.sessionId)
    if (session.status !== 'active') throw new Error('Self-awake session is not active')
    if (session.participants.length > 1) throw new Error('Self-awake requires a single acting character')
    const author = session.participants[0] ?? {}
    const recovery = this.recovery.assertDispatch(job, author, session.environment)
    const request = toJson({ ...selfAwakeRequest(job, author, session.environment), ...(recovery ? { recovery } : {}) })
    const id = this.repository.begin(job, request, author)
    try {
      this.sessions.submitJob(job.sessionId, selfAwakePrompt(request), job.id, job.kind, input => {
        this.repository.dispatchedInTransaction(id, input.inputId, input.turnId)
        this.jobs.completeInTransaction(job.id, input.inputId)
      })
    } catch (error) {
      if (error instanceof Error && /No model configured/.test(error.message)) throw new DeferredJob('Self-awake is waiting for its session model binding')
      this.repository.fail(id, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  private wake(): void {
    if (this.queued || this.closed) return
    this.queued = true
    queueMicrotask(() => {
      this.queued = false
      if (this.closed) return
      try {
        const results = this.repository.pendingResults()
        for (const result of results) {
          if (result.state !== 'completed') { this.repository.fail(result.id, `Self-awake input ${result.state}`); continue }
          const run = this.repository.read(result.id)
          const text = this.repository.finalText(run.sessionId, result.turnId)
          let decision
          try { decision = selfAwakeDecisionSchema.parse(JSON.parse(text)) }
          catch (error) { this.repository.fail(result.id, `Invalid self-awake decision: ${error instanceof Error ? error.message : String(error)}`); continue }
          this.repository.finish(result.id, decision)
          this.onDecision()
        }
        if (results.length === 100) this.wake()
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        this.close()
        process.stderr.write(`Self-awake completion processing stopped: ${this.error}\n`)
      }
    })
  }
}

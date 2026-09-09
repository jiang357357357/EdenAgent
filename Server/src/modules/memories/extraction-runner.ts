import type { JsonValue } from '@eden/api'
import type { RuntimeModel } from '@eden/runtime-pi'
import type { PermissionService } from '../permissions/index.ts'
import { extractionApproval } from './extraction-approval.ts'
import { extractMemoryCandidates } from './extraction.ts'
import type { MemoryExtractionRepository, MemoryExtractionJob } from './extraction-repository.ts'
import type { MemoryExtractionCommitRepository } from './extraction-commit-repository.ts'

interface ExtractionExecution {
  resolve(job: MemoryExtractionJob, signal: AbortSignal): Promise<RuntimeModel>
  record(job: MemoryExtractionJob, snapshot: JsonValue): Promise<void>
}

/** A bounded executor. Scheduling policy decides when to start or resume saved candidates. */
export class MemoryExtractionRunner {
  private readonly active = new Map<string, { controller: AbortController; task: Promise<number[]> }>()
  private closed = false
  constructor(private readonly jobs: MemoryExtractionRepository, private readonly commits: MemoryExtractionCommitRepository,
    private readonly permissions: PermissionService, private readonly execution: ExtractionExecution, private readonly concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Invalid extraction concurrency')
  }

  run(id: string, signal: AbortSignal): Promise<number[]> {
    if (this.closed) return Promise.reject(new Error('Memory extraction runner is closed'))
    const running = this.active.get(id)
    if (running) return running.task
    if (this.active.size >= this.concurrency) return Promise.reject(new Error('Memory extraction runner is busy'))
    const controller = new AbortController()
    const combined = AbortSignal.any([signal, controller.signal])
    const task = Promise.resolve().then(() => this.execute(id, combined))
    this.active.set(id, { controller, task })
    void task.then(() => this.active.delete(id), () => this.active.delete(id))
    return task
  }

  private async execute(id: string, signal: AbortSignal): Promise<number[]> {
    signal.throwIfAborted()
    let job = this.jobs.read(id)
    if (job.state === 'completed') return job.savedIds
    if (job.state === 'queued') job = await this.extract(job, signal)
    if (job.state !== 'candidates') throw new Error(`Memory extraction cannot run from ${job.state}`)
    signal.throwIfAborted()
    const approval = extractionApproval(job)
    const approvalId = approval.details.candidates.length ? await this.permissions.requestWithId({
      sessionId: job.sessionId, turnId: job.turnId, callId: `memory-extraction:${job.id}`, signal,
    }, approval.capability, approval.resource, approval.details) : undefined
    signal.throwIfAborted()
    return this.commits.commit(id, approvalId)
  }

  private async extract(job: MemoryExtractionJob, signal: AbortSignal): Promise<MemoryExtractionJob> {
    const model = await this.execution.resolve(job, signal)
    signal.throwIfAborted()
    const claimed = this.jobs.claim(job.id)
    if (!claimed) throw new Error('Memory extraction could not be claimed')
    try {
      const candidates = await extractMemoryCandidates({ model, userText: claimed.userText, assistantText: claimed.assistantText,
        signal, record: snapshot => this.execution.record(claimed, snapshot) })
      signal.throwIfAborted()
      return this.jobs.saveCandidates(job.id, candidates)
    } catch (error) {
      try { this.jobs.fail(job.id, error instanceof Error ? error.message : String(error), signal.aborted) }
      catch (persistence) { throw new AggregateError([error, persistence], 'Memory extraction failure could not be persisted') }
      throw error
    }
  }

  async close(): Promise<void> {
    this.closed = true
    const pending = [...this.active.values()]
    for (const { controller } of pending) controller.abort(new Error('Memory extraction host is closing'))
    await Promise.allSettled(pending.map(item => item.task))
  }
}

import type { EdenDatabase } from '@eden/store'
import type { DurableEvent, JsonValue } from '@eden/api'
import { memoryCandidatesPageSchema } from '@eden/api'
import type { ModelService } from '../models/index.ts'
import type { PermissionService } from '../permissions/index.ts'
import { MemoryExtractionRepository } from './extraction-repository.ts'
import { MemoryExtractionCommitRepository } from './extraction-commit-repository.ts'
import { MemoryExtractionModels } from './extraction-models.ts'
import { MemoryExtractionRunner } from './extraction-runner.ts'
import { MemoryExtractionQueue } from './extraction-queue.ts'
import { MemoryExtractionEvents } from './extraction-events.ts'
import { recoverMemoryExtractions } from './extraction-recovery.ts'
import { extractionApproval } from './extraction-approval.ts'

interface ExtractionStore {
  database: EdenDatabase
  events: {
    append(sessionId: string, turnId: string | null, kind: string, payload: JsonValue): DurableEvent
    subscribe(listener: (event: DurableEvent) => void): () => void
  }
}

export class MemoryExtractionService {
  readonly jobs: MemoryExtractionRepository
  private readonly queue: MemoryExtractionQueue
  private readonly controller = new AbortController()
  private events: MemoryExtractionEvents | undefined
  private starting: Promise<void> | undefined
  private failure: unknown

  constructor(private readonly sessions: ExtractionStore, models: ModelService, permissions: PermissionService) {
    this.jobs = new MemoryExtractionRepository(sessions.database)
    const bindings = new MemoryExtractionModels(this.jobs, models)
    const runner = new MemoryExtractionRunner(this.jobs, new MemoryExtractionCommitRepository(sessions.database), permissions, {
      resolve: (job, signal) => bindings.resolve(job, signal),
      async record(job, snapshot) {
        sessions.events.append(job.sessionId, job.turnId, 'memory.extraction.model_request', { jobId: job.id, actorId: job.actorId, snapshot })
      },
    })
    this.queue = new MemoryExtractionQueue(this.jobs, runner, (id, error) => {
      const job = this.jobs.read(id)
      sessions.events.append(job.sessionId, job.turnId, 'memory.extraction.failed', {
        jobId: id, actorId: job.actorId, state: job.state, message: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      })
    })
  }

  start(): Promise<void> {
    if (this.controller.signal.aborted) return Promise.reject(new Error('Memory extraction service is closed'))
    this.starting ??= this.initialize().catch(error => {
      if (!this.controller.signal.aborted) this.failure = error
      throw error
    })
    return this.starting
  }

  private async initialize(): Promise<void> {
    await recoverMemoryExtractions(this.jobs, this.controller.signal)
    this.controller.signal.throwIfAborted()
    this.events = new MemoryExtractionEvents(this.sessions.events, this.jobs, this.queue)
    this.queue.wake()
  }

  get fault(): unknown { return this.failure ?? this.events?.fault ?? this.queue.fault }

  candidates(sessionId: string, after?: string, limit?: number) {
    const page = this.jobs.candidates(sessionId, after, limit)
    return memoryCandidatesPageSchema.parse({ items: page.items.map(job => ({ id: job.id, sessionId: job.sessionId, turnId: job.turnId, actorId: job.actorId,
      scopeKey: job.scopeKey, candidates: job.candidates, revision: extractionApproval(job).details.revision,
      processing: this.queue.isRunning(job.id), createdAt: job.createdAt, updatedAt: job.updatedAt })), nextCursor: page.nextCursor })
  }

  resume(sessionId: string, id: string, revision: string) {
    if (!this.events || this.controller.signal.aborted || this.fault !== undefined) throw new Error('Memory extraction service is not available')
    const job = this.jobs.resumable(sessionId, id)
    if (extractionApproval(job).details.revision !== revision) throw new Error('Memory candidates changed; review the current version')
    this.queue.resume(job)
    return { jobId: id, state: 'accepted' as const }
  }

  async close(): Promise<void> {
    this.controller.abort(new Error('Memory extraction service is closing'))
    const drain = this.events ? this.events.close() : this.queue.close()
    const results = await Promise.allSettled([drain, this.starting])
    const error = results[0]?.status === 'rejected' ? results[0].reason : this.failure
    if (error !== undefined) throw error
  }
}

import { z } from 'zod'
import type { DurableEvent } from '@eden/api'
import type { MemoryExtractionRepository } from './extraction-repository.ts'
import type { MemoryExtractionQueue } from './extraction-queue.ts'

interface ExtractionEvents { subscribe(listener: (event: DurableEvent) => void): () => void }
const completed = z.object({ inputId: z.uuid() })

/** Owns only event subscription and queue lifetime; startup reconciliation is a separate durable scan. */
export class MemoryExtractionEvents {
  private readonly unsubscribe: () => void
  private closing: Promise<void> | undefined
  private failure: unknown
  private closed = false

  constructor(events: ExtractionEvents, private readonly jobs: Pick<MemoryExtractionRepository, 'scheduleInput'>,
    private readonly queue: Pick<MemoryExtractionQueue, 'wake' | 'close' | 'fault' | 'cancelSession'>) {
    this.unsubscribe = events.subscribe(event => {
      if (this.closed) return
      try { this.receive(event) }
      catch (error) {
        this.failure = error
        void this.close().catch(() => {}) // The fault remains observable and close will report it again.
      }
    })
  }

  private receive(event: DurableEvent): void {
    if (event.kind === 'turn.completed') {
      if (!event.turnId) throw new Error('Memory extraction completion event requires a turn')
      const payload = completed.parse(event.payload)
      this.jobs.scheduleInput(payload.inputId, { sessionId: event.sessionId, turnId: event.turnId })
      this.queue.wake()
    } else if (event.kind === 'model.bound' || event.kind === 'session.actor_models.bound') this.queue.wake()
    else if (event.kind === 'session.closed' || event.kind === 'session.deleted') this.queue.cancelSession(event.sessionId)
  }

  get fault(): unknown { return this.failure ?? this.queue.fault }

  async close(): Promise<void> {
    if (!this.closed) { this.closed = true; this.unsubscribe() }
    this.closing ??= this.queue.close()
    await this.closing
    if (this.failure !== undefined) throw this.failure
  }
}

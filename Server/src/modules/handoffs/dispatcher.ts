import { configuredModelSchema } from '@eden/api'
import type { SessionRepository, SessionBoundary } from '../sessions/index.ts'
import type { ModelService, ModelBinding, ModelBindingRepository } from '../models/index.ts'
import { HandoffRepository } from './handoff-repository.ts'
import { HandoffCommitRepository } from './commit-repository.ts'

export interface PreparedHandoff { binding: ModelBinding; visionBinding?: ModelBinding | undefined }
export type PrepareHandoff = (sessionId: string, assistantId: string | number, signal: AbortSignal) => Promise<PreparedHandoff | undefined>

export class HandoffDispatcher implements SessionBoundary {
  readonly repository: HandoffRepository
  private readonly commits: HandoffCommitRepository
  constructor(private readonly sessions: SessionRepository, private readonly models: ModelService, private readonly prepare: PrepareHandoff,
    private readonly bindings?: ModelBindingRepository) {
    if (Boolean(bindings) !== models.hasPersistentBindings) throw new Error('Handoff and model service must share durable binding configuration')
    this.repository = new HandoffRepository(sessions)
    this.commits = new HandoffCommitRepository(sessions, this.repository, bindings)
    this.repository.recoverClaims()
  }
  pendingSessions() { return this.repository.pendingSessions() }

  async run(sessionId: string, signal: AbortSignal): Promise<boolean> {
    const job = this.repository.claim(sessionId)
    if (!job) return true
    let prepared: PreparedHandoff | undefined
    try {
      signal.throwIfAborted()
      prepared = await this.prepare(sessionId, job.participant.assistantId, signal)
      signal.throwIfAborted()
    } catch {
      if (signal.aborted) { this.repository.release(job.id); return false }
      this.repository.fail(job.id, 'Target assistant model preparation failed; refresh the model catalogue and review the target')
      return true
    }
    if (!prepared) { this.repository.release(job.id); return false }
    const binding = { ...prepared.binding, model: configuredModelSchema.parse(prepared.binding.model) }
    const vision = prepared.visionBinding ? configuredModelSchema.parse(prepared.visionBinding.model) : undefined
    const committed = this.commits.commit(job.id, binding.model,
      '你刚接手此会话。以当前角色自然承接已有对话；这是一条内部交接指令，不要复述或当作用户发言。',
      { mode: 'single', main: binding, vision: vision ?? null })
    if (this.bindings) this.models.reloadBinding(sessionId)
    else { this.models.bind(sessionId, binding); this.models.bindVision(sessionId, vision) }
    for (const event of committed.events) this.sessions.events.publish(event)
    return true
  }
}

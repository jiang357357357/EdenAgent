import type { JsonValue, DirectorRun } from '@eden/api'
import type { RuntimeModel, RuntimeTool } from '@eden/runtime-pi'
import { ActorExecutionService, ActorCompactionService } from '../actors/index.ts'
import type { SessionInput, SessionRepository } from '../sessions/index.ts'
import { DirectorPlanningService } from './planning-service.ts'
import { DirectorRunRepository } from './run-repository.ts'
import { directorRoster } from './roster.ts'
import { conversationWindow } from '../sessions/index.ts'
import { inputAttachments, attachmentMessage, type AttachmentService } from '../attachments/index.ts'
import type { MemoryRecall } from '../memories/index.ts'

export interface CompanionTurnRequest {
  input: SessionInput; participants: Record<string, JsonValue>[]; directorModel: RuntimeModel
  actorModels: Map<string, RuntimeModel>; tools(assistantId: string | number): RuntimeTool[]; signal: AbortSignal
}

export class CompanionTurnCoordinator {
  private readonly actors: ActorExecutionService
  private readonly planner: DirectorPlanningService
  private readonly compactor: ActorCompactionService
  private readonly active = new Map<string, { controller: AbortController; task: Promise<unknown> }>()
  private closed = false
  constructor(private readonly sessions: SessionRepository, private readonly runs: DirectorRunRepository, private readonly attachments?: AttachmentService, memoryRecall?: MemoryRecall) {
    this.actors = new ActorExecutionService(sessions, memoryRecall)
    this.compactor = new ActorCompactionService(sessions)
    this.planner = new DirectorPlanningService(sessions, runs)
  }

  execute(request: CompanionTurnRequest): Promise<DirectorRun> {
    return this.schedule(request.input.sessionId, request.signal, signal => this.run(request, signal))
  }

  compact(input: SessionInput, models: Map<string, RuntimeModel>, signal: AbortSignal): Promise<void> {
    return this.schedule(input.sessionId, signal, combined => this.compactor.compact(input, models, combined))
  }

  private schedule<T>(id: string, parentSignal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Companion coordinator is shutting down'))
    if (this.active.has(id)) return Promise.reject(new Error('Companion turn is already running'))
    const controller = new AbortController()
    const signal = AbortSignal.any([parentSignal, controller.signal])
    const task = Promise.resolve().then(() => work(signal)).finally(() => this.active.delete(id))
    this.active.set(id, { controller, task })
    return task
  }

  private async run(request: CompanionTurnRequest, signal: AbortSignal): Promise<DirectorRun> {
    signal.throwIfAborted()
    const { input } = request
    const snapshots = inputAttachments(input.metadata)
    if (snapshots.length && !this.attachments) throw new Error('Attachment service unavailable')
    const images = snapshots.length ? await this.attachments!.images(snapshots) : []
    signal.throwIfAborted()
    const roster = directorRoster(request.participants)
    const models = new Map(roster.map(actor => {
      const model = request.actorModels.get(String(actor.assistantId))
      if (!model) throw new Error(`No model bound for actor ${actor.assistantId}`)
      return [String(actor.assistantId), structuredClone(model)] as const
    }))
    const conversation = conversationWindow(this.sessions.events.messages(input.sessionId, undefined, 100).items.map(event => event.payload))
    this.sessions.events.append(input.sessionId, input.turnId, 'agent.message_end', attachmentMessage({
      type: 'message_end', messageId: input.id, message: { role: 'user', content: [{ type: 'text', text: input.text }], timestamp: Date.now() },
    }, input.metadata))
    const plan = await this.planner.plan({ sessionId: input.sessionId, turnId: input.turnId, userText: input.text,
      participants: request.participants, model: request.directorModel, conversation: JSON.stringify(conversation), attachments: snapshots.length ? JSON.stringify(snapshots) : '', signal, userMessageID: input.id })
    try {
      let progress = plan
      for (const [beatIndex, beat] of plan.beats.entries()) {
        signal.throwIfAborted()
        const participant = request.participants.find(actor => String(actor.assistantId) === String(beat.assistantID))
        const model = models.get(String(beat.assistantID))
        if (!participant || !model) throw new Error('Director selected an unbound actor')
        this.runs.startBeat(plan.planID, beatIndex)
        await this.actors.execute({ input, plan, beatIndex, participant, model,
          tools: request.tools(beat.assistantID), refreshTools: () => request.tools(beat.assistantID), conversation, signal, images })
        signal.throwIfAborted()
        progress = this.runs.completeBeat(plan.planID, beatIndex)
        const latest = conversationWindow(this.sessions.events.messages(input.sessionId, undefined, 100).items.map(event => event.payload))
        conversation.splice(0, conversation.length, ...latest)
      }
      return progress
    } catch (error) {
      this.runs.fail(plan.planID, signal.aborted ? 'Companion turn was cancelled' : 'Companion actor execution failed')
      throw error
    }
  }

  async close(): Promise<void> {
    this.closed = true
    const active = [...this.active.values()]
    for (const item of active) item.controller.abort()
    await Promise.allSettled(active.map(item => item.task))
    await this.actors.close()
  }

  async inject(sessionId: string, text: string, kind: 'steer' | 'follow_up'): Promise<boolean> {
    if (this.closed || this.active.get(sessionId)?.controller.signal.aborted) throw new Error('Companion turn is closing')
    return this.actors.inject(sessionId, text, kind)
  }
}

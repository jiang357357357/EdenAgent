import { createRuntime } from '@eden/runtime-pi'
import type { RuntimeModel, RuntimeTool, EdenRuntime, RuntimeImage } from '@eden/runtime-pi'
import { actorIdSchema } from '@eden/api'
import type { DirectorPlan, JsonValue } from '@eden/api'
import { runtimeCallbacks } from '../sessions/index.ts'
import type { SessionInput, SessionRepository } from '../sessions/index.ts'
import { ActorCheckpointRepository } from './checkpoint-repository.ts'
import { actorPrompt, actorSystemPrompt } from './actor-prompt.ts'
import { actorMessage } from './message-context.ts'
import type { MemoryRecall } from '../memories/index.ts'

export interface ActorExecutionRequest {
  input: SessionInput; plan: DirectorPlan; beatIndex: number; participant: Record<string, JsonValue>
  model: RuntimeModel; tools: RuntimeTool[]; conversation: JsonValue[]; signal: AbortSignal
  refreshTools?(): RuntimeTool[]
  images?: readonly RuntimeImage[]
}

export class ActorExecutionService {
  private readonly active = new Map<string, { controller: AbortController; task: Promise<JsonValue> }>()
  private closed = false
  private readonly runtimes = new Map<string, EdenRuntime>()
  private readonly checkpoints: ActorCheckpointRepository
  constructor(private readonly sessions: SessionRepository, private readonly memoryRecall?: MemoryRecall) { this.checkpoints = new ActorCheckpointRepository(sessions) }

  execute(request: ActorExecutionRequest): Promise<JsonValue> {
    if (this.closed) return Promise.reject(new Error('Actor execution is shutting down'))
    const id = request.input.sessionId
    if (this.active.has(id)) return Promise.reject(new Error('An actor is already executing in this session'))
    const controller = new AbortController()
    const signal = AbortSignal.any([request.signal, controller.signal])
    const task = Promise.resolve().then(() => this.run(request, signal)).finally(() => this.active.delete(id))
    this.active.set(id, { controller, task })
    return task
  }

  private async run(request: ActorExecutionRequest, signal: AbortSignal): Promise<JsonValue> {
    signal.throwIfAborted()
    const { input, plan, beatIndex } = request
    const assistantId = actorIdSchema.parse(request.participant.assistantId)
    if (String(plan.beats[beatIndex]?.assistantID) !== String(assistantId)) throw new Error('Director beat does not match the executing actor')
    const actor = { assistantID: assistantId, planID: plan.planID, beatIndex }
    const callbacks = runtimeCallbacks(this.sessions, input, { actor, privateNonAssistantMessages: true,
      checkpoint: async snapshot => this.checkpoints.save(input.sessionId, assistantId, input.turnId, snapshot) })
    const checkpoint = this.checkpoints.read(input.sessionId, assistantId)
    const runtime = createRuntime({ sessionId: input.sessionId, model: request.model, tools: request.tools, ...(request.refreshTools ? { refreshTools: request.refreshTools } : {}),
      systemPrompt: actorSystemPrompt(request.participant, input.metadata) + (this.memoryRecall?.prompt(input.sessionId, input.turnId, input.text, assistantId) ?? ''),
      toolCallPrefix: `${plan.planID}:${beatIndex}:`, ...(checkpoint ? { checkpoint } : {}),
      callbacks: { ...callbacks, event: async (kind, payload) => callbacks.event(kind, actorMessage(payload, request.participant, plan, beatIndex)) },
    })
    this.runtimes.set(input.sessionId, runtime)
    let aborting: Promise<void> | undefined
    const abort = () => { aborting = runtime.abort(); void aborting.catch(() => undefined) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted()
      const response = await runtime.prompt(actorPrompt(input.text, plan, beatIndex, request.conversation), request.images)
      signal.throwIfAborted()
      const value = response && typeof response === 'object' && !Array.isArray(response) ? response : {}
      if (value.stopReason === 'error' || value.stopReason === 'aborted') throw new Error('Actor model response did not complete')
      return response
    } finally { this.runtimes.delete(input.sessionId); signal.removeEventListener('abort', abort); await aborting }
  }

  async inject(sessionId: string, text: string, kind: 'steer' | 'follow_up'): Promise<boolean> {
    if (this.closed || this.active.get(sessionId)?.controller.signal.aborted) throw new Error('Actor execution is closing')
    const runtime = this.runtimes.get(sessionId)
    if (!runtime) return false
    if (kind === 'steer') await runtime.steer(text)
    else await runtime.followUp(text)
    return true
  }

  async close(): Promise<void> {
    this.closed = true
    const active = [...this.active.values()]
    for (const item of active) item.controller.abort()
    await Promise.allSettled(active.map(item => item.task))
  }
}

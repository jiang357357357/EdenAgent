import { createRuntime } from '@eden/runtime-pi'
import type { RuntimeModel, RuntimeCallbacks } from '@eden/runtime-pi'
import { runtimeCallbacks } from '../sessions/index.ts'
import type { SessionInput, SessionRepository } from '../sessions/index.ts'
import { ActorCheckpointRepository } from './checkpoint-repository.ts'

export class ActorCompactionService {
  private readonly checkpoints: ActorCheckpointRepository
  constructor(private readonly sessions: SessionRepository) { this.checkpoints = new ActorCheckpointRepository(sessions) }

  async compact(input: SessionInput, models: Map<string, RuntimeModel>, signal: AbortSignal): Promise<void> {
    for (const [assistantID, model] of models) {
      signal.throwIfAborted()
      await this.compactActor(input, assistantID, model, signal)
    }
  }

  private async compactActor(input: SessionInput, assistantID: string, model: RuntimeModel, signal: AbortSignal): Promise<void> {
    const checkpoint = this.checkpoints.read(input.sessionId, assistantID)
    const event = (kind: string) => this.sessions.events.append(input.sessionId, input.turnId, `actor.compaction.${kind}`, { assistantID })
    if (!checkpoint?.entries.length) { event('skipped'); return }
    event('started')
    const callbacks = runtimeCallbacks(this.sessions, input, { actor: { assistantID }, privateNonAssistantMessages: true,
      checkpoint: async snapshot => this.checkpoints.save(input.sessionId, assistantID, input.turnId, snapshot) })
    let persistenceFailed = false
    const guard = async (work: () => Promise<void>) => {
      try { await work() } catch (error) { persistenceFailed = true; throw error }
    }
    const guarded: RuntimeCallbacks = {
      checkpoint: snapshot => guard(() => callbacks.checkpoint(snapshot)),
      event: (kind, payload) => guard(() => callbacks.event(kind, payload)),
      request: snapshot => guard(() => callbacks.request(snapshot)),
    }
    const runtime = createRuntime({ sessionId: input.sessionId, model, checkpoint, tools: [], systemPrompt: '', callbacks: guarded })
    let aborting: Promise<void> | undefined
    const abort = () => { aborting = runtime.abort(); void aborting.catch(() => undefined) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted()
      await runtime.compact(input.text)
      signal.throwIfAborted()
      event('completed')
    } catch (error) {
      event(signal.aborted ? 'cancelled' : 'failed')
      if (signal.aborted && !persistenceFailed) throw signal.reason
      throw error
    } finally { signal.removeEventListener('abort', abort); await aborting }
  }
}

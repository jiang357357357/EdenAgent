import { z } from 'zod'
import { jsonValue } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { RuntimeModel, RuntimeTool } from '@eden/runtime-pi'
import { modelDescriptor, assertModelSnapshot } from '../sessions/index.ts'
import type { SessionInput, SessionTurnExtension } from '../sessions/index.ts'
import type { ModelService } from '../models/index.ts'
import { CompanionTurnCoordinator } from './turn-coordinator.ts'
import { directorRoster } from './roster.ts'

const metadataSchema = z.object({ participants: z.array(z.record(z.string(), jsonValue)),
  companion: z.object({ actors: z.array(z.object({ assistantId: z.string(), model: jsonValue })), director: jsonValue }) })

export class CompanionSessionExtension implements SessionTurnExtension {
  constructor(private readonly coordinator: CompanionTurnCoordinator, private readonly models: ModelService,
    private readonly tools: (sessionId: string, turnId: string, actorId?: string | number) => RuntimeTool[]) {}

  private capture(sessionId: string, participants: JsonValue[]): Map<string, RuntimeModel> | undefined {
    const result = new Map<string, RuntimeModel>()
    for (const actor of directorRoster(participants)) {
      const model = this.models.resolveActorModel(sessionId, actor.assistantId)
      if (!model) return undefined
      result.set(String(actor.assistantId), structuredClone(model))
    }
    return result
  }

  snapshot(sessionId: string, participants: JsonValue[]): JsonValue | undefined {
    const models = this.capture(sessionId, participants)
    const director = this.models.resolveDirector(sessionId)
    return models && director ? { actors: [...models].map(([assistantId, model]) => ({ assistantId, model: modelDescriptor(model) })),
      director: modelDescriptor(director) } : undefined
  }

  async execute(input: SessionInput, signal: AbortSignal): Promise<void> {
    const metadata = metadataSchema.parse(input.metadata)
    const actorModels = this.capture(input.sessionId, metadata.participants)
    if (!actorModels || actorModels.size !== metadata.companion.actors.length) throw new Error('Queued actor model configuration changed; review and resubmit')
    for (const saved of metadata.companion.actors) {
      const model = actorModels.get(saved.assistantId)
      if (!model) throw new Error('Queued actor binding changed; review and resubmit')
      assertModelSnapshot({ model: saved.model }, model)
    }
    const directorModel = this.models.resolveDirector(input.sessionId)
    if (!directorModel) throw new Error('Queued director model binding missing; review and resubmit')
    assertModelSnapshot({ model: metadata.companion.director }, directorModel)
    if (input.kind === 'compact') { await this.coordinator.compact(input, actorModels, signal); return }
    await this.coordinator.execute({ input, participants: metadata.participants, actorModels, directorModel,
      tools: actorId => this.tools(input.sessionId, input.turnId, actorId), signal })
  }

  inject(sessionId: string, text: string, kind: 'steer' | 'follow_up'): Promise<boolean> {
    return this.coordinator.inject(sessionId, text, kind)
  }
}

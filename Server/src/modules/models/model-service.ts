import type { RuntimeModel } from '@eden/runtime-pi'
import type { RuntimeOrigin, JsonValue } from '@eden/api'
import { configuredModelSchema, actorIdSchema } from '@eden/api'
import type { ModelBinding, ActorModelBinding } from './contracts.ts'
import { modelStatus } from './model-status.ts'
import type { ModelBindingRepository, ModelBindingSnapshot } from './binding-repository.ts'

export class ModelService {
  private readonly configured: RuntimeModel | undefined
  private readonly bindings = new Map<string, ModelBinding>()
  private readonly visionBindings = new Map<string, RuntimeModel>()
  private readonly directors = new Map<string, RuntimeModel>()
  private readonly actors = new Map<string, Map<string, ActorModelBinding>>()
  constructor(private readonly origin: RuntimeOrigin, configured?: RuntimeModel, private readonly storage?: ModelBindingRepository) {
    if (origin === 'mon' && configured) throw new Error('Mon models must be bound through the Mon integration')
    this.configured = configured ? configuredModelSchema.parse(configured) : undefined
    if (origin === 'local' && storage) throw new Error('Local models cannot restore Mon bindings')
    for (const key of storage?.keys() ?? []) this.refresh(key)
  }

  bind(sessionId: string | undefined, binding: ModelBinding | undefined): void {
    if (this.origin !== 'mon') throw new Error('Local models cannot be configured from Mon')
    const key = sessionId ?? 'default'
    if (!binding) this.invalidateSession(key)
    else {
      const validated = { ...binding, model: configuredModelSchema.parse(binding.model) }
      this.replace(key, { mode: 'single', main: validated, vision: null })
    }
  }

  resolve(sessionId: string): RuntimeModel | undefined {
    this.refresh(sessionId)
    return this.origin === 'local' ? this.configured : this.bindings.get(sessionId)?.model
  }

  invalidateSession(sessionId: string): void {
    this.storage?.remove(sessionId)
    this.clear(sessionId)
  }

  private clear(sessionId: string): void {
    this.bindings.delete(sessionId)
    this.visionBindings.delete(sessionId)
    this.actors.delete(sessionId)
    this.directors.delete(sessionId)
  }

  bindActors(sessionId: string, bindings: ActorModelBinding[], director?: RuntimeModel): void {
    if (this.origin !== 'mon') throw new Error('Local actor models cannot be configured from Mon')
    const actors = new Map<string, ActorModelBinding>()
    for (const binding of bindings) {
      const key = String(binding.assistantId)
      if (actors.has(key)) throw new Error('Duplicate actor model binding')
      actors.set(key, { ...binding, main: { ...binding.main, model: configuredModelSchema.parse(binding.main.model) },
        vision: binding.vision ? { ...binding.vision, model: configuredModelSchema.parse(binding.vision.model) } : undefined })
    }
    const directorModel = director ? configuredModelSchema.parse(director) : undefined
    this.replace(sessionId, { mode: 'multi', director: directorModel ?? null,
      actors: [...actors.values()].map(actor => ({ ...actor, vision: actor.vision ?? null })) })
  }

  resolveDirector(sessionId: string): RuntimeModel | undefined {
    this.refresh(sessionId)
    return this.origin === 'local' ? this.configured : this.directors.get(sessionId)
  }

  resolveActor(sessionId: string, assistantId: string | number): ActorModelBinding | undefined {
    this.refresh(sessionId)
    return this.actors.get(sessionId)?.get(String(assistantId))
  }

  resolveActorModel(sessionId: string, assistantId: string | number): RuntimeModel | undefined {
    return this.origin === 'local' ? this.configured : this.resolveActor(sessionId, assistantId)?.main.model
  }

  bindVision(sessionId: string, model: RuntimeModel | undefined): void {
    if (this.origin !== 'mon') throw new Error('Local vision models cannot be configured from Mon')
    this.refresh(sessionId)
    if (this.actors.has(sessionId)) throw new Error('Multi-actor vision models require actor bindings')
    this.replace(sessionId, { mode: 'single', main: this.bindings.get(sessionId) ?? null,
      vision: model ? configuredModelSchema.parse(model) : null })
  }

  resolveVision(sessionId: string): RuntimeModel | undefined { this.refresh(sessionId); return this.visionBindings.get(sessionId) }

  private replace(key: string, snapshot: ModelBindingSnapshot): void {
    this.storage?.save(key, snapshot)
    this.install(key, structuredClone(snapshot))
  }

  commitBinding<T>(key: string, snapshot: ModelBindingSnapshot, work: () => T): T {
    if (!this.storage) throw new Error('Atomic model binding requires durable storage')
    const result = this.storage.commit(key, snapshot, work)
    this.refresh(key)
    return result
  }

  get hasPersistentBindings(): boolean { return Boolean(this.storage) }
  reloadBinding(key: string): void {
    if (!this.storage) throw new Error('Model binding reload requires durable storage')
    this.refresh(key)
  }

  private refresh(key: string): void {
    if (!this.storage) return
    const snapshot = this.storage.read(key)
    if (snapshot) this.install(key, snapshot)
    else this.clear(key)
  }

  private install(key: string, snapshot: ModelBindingSnapshot): void {
    this.clear(key)
    if (snapshot.mode === 'single') {
      if (snapshot.main) this.bindings.set(key, snapshot.main)
      if (snapshot.vision) this.visionBindings.set(key, snapshot.vision)
    } else {
      this.actors.set(key, new Map(snapshot.actors.map(actor => [String(actor.assistantId), { ...actor, vision: actor.vision ?? undefined }])))
      if (snapshot.director) this.directors.set(key, snapshot.director)
    }
  }

  read(sessionId?: string, participants?: JsonValue[]) {
    this.refresh(sessionId ?? 'default')
    const binding = this.bindings.get(sessionId ?? 'default')
    const model = this.origin === 'local' ? this.configured : binding?.model
    const roster = participants ?? [...(this.actors.get(sessionId ?? '')?.values() ?? [])].map(actor => ({ assistantId: actor.assistantId }))
    if (!sessionId || roster.length < 2) return modelStatus(this.origin, model, binding)
    const actors = roster.map(participant => {
      const value = participant && typeof participant === 'object' && !Array.isArray(participant) ? participant : {}
      const id = actorIdSchema.safeParse(value.assistantId)
      const actor = id.success ? this.resolveActor(sessionId, id.data) : undefined
      return { assistantID: id.success ? id.data : null,
        ...modelStatus(this.origin, id.success ? this.resolveActorModel(sessionId, id.data) : undefined, actor?.main) }
    })
    const director = modelStatus(this.origin, this.resolveDirector(sessionId))
    const available = director.available && actors.length <= 32 && actors.every(actor => actor.available) && new Set(actors.map(actor => String(actor.assistantID))).size === actors.length
    return { ...modelStatus(this.origin), mode: 'multi_actor', actors, director, available,
      label: `${actors.filter(actor => actor.available).length}/${actors.length} actor models configured`,
      error: available ? null : 'Bind a director and a model for every distinct session participant before starting a conversation',
    }
  }
}

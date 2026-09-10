import type { RuntimeModel } from '@eden/runtime-pi'
import type { RuntimeOrigin, JsonValue } from '@eden/api'
import { configuredModelSchema, actorIdSchema } from '@eden/api'
import type { ModelBinding, ActorModelBinding } from './contracts.ts'
import { modelStatus } from './model-status.ts'
import type { ModelBindingRepository, ModelBindingSnapshot } from './binding-repository.ts'
import type { ModelPricingRepository } from './pricing-repository.ts'
import type { ModelPricingTarget } from '@eden/api'
import { childModel } from './child-model.ts'
import type { ChildModelOptions } from './child-model.ts'
import type { LocalChildModels } from './local-child-models.ts'

export class ModelService {
  private readonly configured: RuntimeModel | undefined
  private readonly bindings = new Map<string, ModelBinding>()
  private readonly visionBindings = new Map<string, RuntimeModel>()
  private readonly visionEntities = new Map<string, string | number>()
  private readonly directors = new Map<string, RuntimeModel>()
  private readonly actors = new Map<string, Map<string, ActorModelBinding>>()
  constructor(private readonly origin: RuntimeOrigin, configured?: RuntimeModel, private readonly storage?: ModelBindingRepository, readonly pricing?: ModelPricingRepository, private readonly localChildren?: LocalChildModels) {
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

  inherit(parentSessionId: string, childSessionId: string, options?: ChildModelOptions): void {
    const snapshot = this.childSnapshot(parentSessionId, options)
    if (snapshot.origin === 'local') {
      if (!this.localChildren) {
        if (options?.model || options?.reasoning != null) throw new Error('Durable local child model settings are unavailable')
        return
      }
      this.localChildren.save(childSessionId, snapshot.model, snapshot.independent)
      return
    }
    this.replace(childSessionId, snapshot.binding)
  }

  /** Private snapshot for inheritance/recovery; never return this value through RPC. */
  childSnapshot(parentSessionId: string, options?: ChildModelOptions) {
    if (this.origin === 'local') {
      return this.localChildSnapshot(parentSessionId, options)
    }
    this.refresh(parentSessionId)
    const actor = options?.actorId === undefined ? undefined : this.actors.get(parentSessionId)?.get(String(options.actorId))
    if (this.actors.has(parentSessionId) && !actor) throw new Error('Select a bound acting parent for the child model')
    const parentBinding = actor?.main ?? this.bindings.get(parentSessionId)
    if (!parentBinding) throw new Error('Confirm the parent model binding before creating independent children')
    const independent = options?.model ? this.storage?.childProfiles.resolve(parentSessionId, options.model) : undefined
    const binding = independent ?? parentBinding
    if (!binding) throw new Error('Subagent requires a bound single-actor parent model')
    return {
      origin: 'mon' as const, binding: {
        mode: 'single' as const,
        main: { ...structuredClone(binding), model: childModel(binding.model, options) },
        vision: structuredClone(this.childVision(parentSessionId, actor)), visionEntityId: actor ? actor.vision?.entityId ?? null : this.visionEntities.get(parentSessionId) ?? null
      }
    }
  }

  private localChildSnapshot(parentSessionId: string, options?: ChildModelOptions) {
    const profile = options?.model ? this.localChildren?.profiles.resolve(options.model) : undefined
    if (profile) return { origin: 'local' as const, model: childModel(profile, options), independent: true }
    const parent = this.resolve(parentSessionId)
    if (!parent) throw new Error('No local model configured')
    if (this.localChildren?.isIndependent(parentSessionId)) return { origin: 'local' as const, model: childModel(parent, options), independent: true }
    const { apiKey: _apiKey, ...model } = childModel(parent, options)
    return { origin: 'local' as const, model, independent: false }
  }

  private childVision(sessionId: string, actor: ActorModelBinding | undefined) {
    return actor ? actor.vision?.model ?? null : this.visionBindings.get(sessionId) ?? null
  }

  resolve(sessionId: string): RuntimeModel | undefined {
    this.refresh(sessionId)
    return this.withRates(this.origin === 'local' ? this.localChildren?.resolve(sessionId, this.configured) ?? this.configured : this.bindings.get(sessionId)?.model)
  }
  activateChildSnapshotInTransaction(sessionId: string, snapshot: ReturnType<ModelService['childSnapshot']>): void {
    if (snapshot.origin !== this.origin) throw new Error('Recovered model belongs to another world')
    if (snapshot.origin === 'local') {
      if (!this.localChildren) throw new Error('Durable local model storage is unavailable')
      this.localChildren.saveInTransaction(sessionId, snapshot.model, snapshot.independent)
    } else {
      if (!this.storage) throw new Error('Durable Mon model storage is unavailable')
      this.storage.saveInTransaction(sessionId, snapshot.binding)
    }
  }

  monChildProfiles() {
    if (this.origin !== 'mon' || !this.storage) throw new Error('Mon child model storage is unavailable')
    return this.storage.childProfiles
  }

  localProfiles() {
    if (this.origin !== 'local' || !this.localChildren) throw new Error('Independent local model profiles are unavailable in this world')
    return this.localChildren.profiles
  }

  invalidateSession(sessionId: string): void {
    this.localChildren?.remove(sessionId)
    this.storage?.remove(sessionId)
    this.clear(sessionId)
  }

  private clear(sessionId: string): void {
    this.bindings.delete(sessionId)
    this.visionBindings.delete(sessionId)
    this.visionEntities.delete(sessionId)
    this.actors.delete(sessionId)
    this.directors.delete(sessionId)
  }

  bindActors(sessionId: string, bindings: ActorModelBinding[], director?: RuntimeModel): void {
    if (this.origin !== 'mon') throw new Error('Local actor models cannot be configured from Mon')
    const actors = new Map<string, ActorModelBinding>()
    for (const binding of bindings) {
      const key = String(binding.assistantId)
      if (actors.has(key)) throw new Error('Duplicate actor model binding')
      actors.set(key, {
        ...binding, main: { ...binding.main, model: configuredModelSchema.parse(binding.main.model) },
        vision: binding.vision ? { ...binding.vision, model: configuredModelSchema.parse(binding.vision.model) } : undefined
      })
    }
    const directorModel = director ? configuredModelSchema.parse(director) : undefined
    this.replace(sessionId, {
      mode: 'multi', director: directorModel ?? null,
      actors: [...actors.values()].map(actor => ({ ...actor, vision: actor.vision ?? null }))
    })
  }

  resolveDirector(sessionId: string): RuntimeModel | undefined {
    this.refresh(sessionId)
    return this.withRates(this.origin === 'local' ? this.configured : this.directors.get(sessionId))
  }

  resolveActor(sessionId: string, assistantId: string | number): ActorModelBinding | undefined {
    this.refresh(sessionId)
    const actor = this.actors.get(sessionId)?.get(String(assistantId))
    return actor ? {
      ...actor, main: { ...actor.main, model: this.withRates(actor.main.model)! },
      ...(actor.vision ? { vision: { ...actor.vision, model: this.withRates(actor.vision.model)! } } : {})
    } : undefined
  }

  resolveActorModel(sessionId: string, assistantId: string | number): RuntimeModel | undefined {
    return this.origin === 'local' ? this.withRates(this.configured) : this.resolveActor(sessionId, assistantId)?.main.model
  }

  bindVision(sessionId: string, model: RuntimeModel | undefined, entityId?: string | number | null): void {
    if (this.origin !== 'mon') throw new Error('Local vision models cannot be configured from Mon')
    this.refresh(sessionId)
    if (this.actors.has(sessionId)) throw new Error('Multi-actor vision models require actor bindings')
    this.replace(sessionId, {
      mode: 'single', main: this.bindings.get(sessionId) ?? null,
      vision: model ? configuredModelSchema.parse(model) : null, visionEntityId: model && entityId != null ? actorIdSchema.parse(entityId) : null
    })
  }

  resolveVision(sessionId: string): RuntimeModel | undefined { this.refresh(sessionId); return this.withRates(this.visionBindings.get(sessionId)) }

  private withRates(model: RuntimeModel | undefined) { return this.pricing ? this.pricing.apply(model) : model }

  pricingModel(selection: ModelPricingTarget): RuntimeModel {
    const model = selection.target === 'main' ? this.resolve(selection.sessionId) : selection.target === 'director' ? this.resolveDirector(selection.sessionId) :
      selection.target === 'vision' ? this.resolveVision(selection.sessionId) : selection.target === 'actor' ? this.resolveActorModel(selection.sessionId, selection.assistantId!) :
        this.resolveActor(selection.sessionId, selection.assistantId!)?.vision?.model
    if (!model) throw new Error('Selected model is not currently bound')
    return model
  }

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
      if (snapshot.visionEntityId != null) this.visionEntities.set(key, snapshot.visionEntityId)
    } else {
      this.actors.set(key, new Map(snapshot.actors.map(actor => [String(actor.assistantId), { ...actor, vision: actor.vision ?? undefined }])))
      if (snapshot.director) this.directors.set(key, snapshot.director)
    }
  }

  read(sessionId?: string, participants?: JsonValue[]) {
    this.refresh(sessionId ?? 'default')
    const binding = this.bindings.get(sessionId ?? 'default')
    const model = this.origin === 'local' ? sessionId ? this.resolve(sessionId) : this.configured : binding?.model
    const roster = participants ?? [...(this.actors.get(sessionId ?? '')?.values() ?? [])].map(actor => ({ assistantId: actor.assistantId }))
    if (!sessionId || roster.length < 2) return modelStatus(this.origin, model, binding)
    const actors = roster.map(participant => {
      const value = participant && typeof participant === 'object' && !Array.isArray(participant) ? participant : {}
      const id = actorIdSchema.safeParse(value.assistantId)
      const actor = id.success ? this.resolveActor(sessionId, id.data) : undefined
      return {
        assistantID: id.success ? id.data : null,
        ...modelStatus(this.origin, id.success ? this.resolveActorModel(sessionId, id.data) : undefined, actor?.main)
      }
    })
    const director = modelStatus(this.origin, this.resolveDirector(sessionId))
    const available = director.available && actors.length <= 32 && actors.every(actor => actor.available) && new Set(actors.map(actor => String(actor.assistantID))).size === actors.length
    return {
      ...modelStatus(this.origin), mode: 'multi_actor', actors, director, available,
      label: `${actors.filter(actor => actor.available).length}/${actors.length} actor models configured`,
      error: available ? null : 'Bind a director and a model for every distinct session participant before starting a conversation',
    }
  }
}

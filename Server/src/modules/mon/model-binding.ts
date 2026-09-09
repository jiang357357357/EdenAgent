import { monLegacyReplaySchema } from '@eden/api'
import { replayLegacyDelivery } from './legacy-replay.ts'
import { LegacyReplayRepository } from './legacy-replay-repository.ts'
import { resolveLegacySync } from './legacy-sync-review.ts'
import { prepareLegacyIdentity } from './legacy-identity.ts'
import { readOwnerQqHistory } from './contact-history.ts'
import { deliverOwnerQq, ownerQqTarget } from './qq-contact.ts'
import { deliverOwnerEmail } from './email-contact.ts'
import { MonSyncStatus } from './sync-status.ts'
import { MonSyncWorker } from './sync-worker.ts'
import { MonSessionProjection } from './session-projection.ts'
import { synthesizeMonSpeech } from './speech.ts'
import type { VoiceSynthesizeInput } from '@eden/api'
import { MonClient, MonHttpError } from '@eden/integrations'
import { toJson } from '@eden/api'
import type { JsonValue, MonOperationQuery, ModelSelectionTarget, AssistantTarget } from '@eden/api'
import type { ModelService } from '../models/index.ts'
import type { SessionService } from '../sessions/index.ts'
import { loadMonCatalog } from './model-catalog.ts'
import { coreEntities, resolveCoreModel } from './model-schema.ts'
import { prepareModelSelection } from './model-selection.ts'
import { MonOperationRepository } from './operation-repository.ts'
import { loadActorCatalog } from './actor-catalog.ts'
import { assistantCatalog, assistantSummary, resolveAssistantTarget } from './assistant-catalog.ts'
import { selectionTarget } from './selection-target.ts'
import { commitMonModels } from './commit-models.ts'
import { MonConnectionRepository } from './connection-repository.ts'

interface CatalogRequest { coreBaseUrl: string; coreToken: string; sessionId?: string | null | undefined }

export class MonBindingService {
  private readonly controllers = new Set<AbortController>()
  private readonly tasks = new Set<Promise<JsonValue>>()
  private readonly connections: MonConnectionRepository | undefined
  private closed = false
  private selectionTail: Promise<void> = Promise.resolve()
  private readonly sync: MonSyncWorker | undefined
  private readonly projection: MonSessionProjection
  private readonly operations: MonOperationRepository
  constructor(private readonly models: ModelService, private readonly sessions: SessionService) {
    sessions.repository.database.connection.prepare("UPDATE mon_contact_deliveries SET state='unknown',error='Host restarted before contact receipt confirmation' WHERE state='running'").run()
    new LegacyReplayRepository(sessions.repository).recover()
    this.projection = new MonSessionProjection(sessions.repository)
    this.operations = new MonOperationRepository(sessions.repository)
    this.connections = sessions.repository.origin === 'mon' ? new MonConnectionRepository(sessions.repository.database) : undefined
    this.sync = this.connections ? new MonSyncWorker(sessions.repository, this.connections, this.projection) : undefined
  }

  async catalog(params: CatalogRequest): Promise<JsonValue> {
    return this.run(params, signal => this.load(params, signal))
  }

  listOperations(params: MonOperationQuery): JsonValue[] {
    if (this.closed) throw new Error('Mon integration is shutting down')
    if (this.sessions.repository.origin !== 'mon') throw new Error('Mon operations are only available in Mon')
    if (params.sessionId) this.sessions.repository.read(params.sessionId)
    return this.operations.list(params)
  }

  childProfiles(sessionId: string) {
    this.sessions.repository.read(sessionId)
    return this.models.monChildProfiles().list(sessionId)
  }
  removeChildProfile(sessionId: string, key: string, revision: string) {
    this.sessions.repository.read(sessionId)
    return this.models.monChildProfiles().remove(sessionId, key, revision)
  }
  async childCatalog(sessionId: string) {
    const connection = this.connections?.read(sessionId)
    if (!connection) throw new Error('Refresh the parent model catalogue to bind Mon Core first')
    return this.run({ ...connection, sessionId }, async signal => {
      const entities = coreEntities(await this.assistantClient(sessionId).getCollection('/api/ai/entities/', signal))
      return toJson(entities.filter(entity => entity.status === 'active').map(entity => ({ entityId: String(entity.id),
        key: `${entity.vendor}/${entity.ai_model}`, label: entity.ai_name || entity.ai_model })))
    })
  }
  async bindChildProfile(sessionId: string, entityId: string | number, expectedRevision: string | null) {
    const connection = this.connections?.read(sessionId)
    if (!connection) throw new Error('Refresh the parent model catalogue to bind Mon Core first')
    return this.run({ ...connection, sessionId }, async signal => {
      const profiles = this.models.monChildProfiles(), hash = profiles.captureConnection(sessionId)
      const binding = resolveCoreModel(await this.assistantClient(sessionId).get(`/api/ai/entities/${encodeURIComponent(String(entityId))}/`, signal))
      signal.throwIfAborted()
      if (String(binding.entityId) !== String(entityId)) throw new Error('Mon child model detail identity mismatch')
      return toJson(profiles.save(sessionId, binding, expectedRevision, hash))
    })
  }

  async select(params: CatalogRequest & { aiEntityId: string | number; target?: ModelSelectionTarget | undefined }): Promise<JsonValue> {
    return this.run(params, signal => {
      const task = this.selectionTail.then(() => this.applySelection(params, signal))
      this.selectionTail = task.then(() => undefined, () => undefined)
      return task
    })
  }

  private async applySelection(params: CatalogRequest & { aiEntityId: string | number; target?: ModelSelectionTarget | undefined }, signal: AbortSignal): Promise<JsonValue> {
      signal.throwIfAborted()
      await prepareLegacyIdentity(this.sessions.repository.database, params.sessionId ?? undefined, params.coreBaseUrl, params.coreToken, signal)
      const client = new MonClient(params.coreBaseUrl, params.coreToken)
      const participants = params.sessionId ? this.sessions.repository.read(params.sessionId).participants : []
      const target = selectionTarget(params.target, params.sessionId ?? undefined, participants)
      const selection = await prepareModelSelection(client, params.aiEntityId, target.assistantId, signal, target.forceCharacter)
      signal.throwIfAborted()
      const operationId = this.operations.begin(params.sessionId ?? undefined, selection.endpoint, toJson({ coreBaseUrl: params.coreBaseUrl, body: selection.body, target: params.target ?? null }))
      try { await client.patch(selection.endpoint, toJson(selection.body), signal) }
      catch (error) {
        const rejected = error instanceof MonHttpError && [400, 401, 403, 404, 422].includes(error.status)
        if (!rejected) this.models.bind(params.sessionId ?? undefined, undefined)
        this.operations.finish(operationId, rejected ? 'failed' : 'unknown', rejected ? 'Mon rejected the selection request' : 'Mon selection response was not confirmed; inspect remote state before retrying')
        throw new Error(`Mon selection ${rejected ? 'was rejected' : 'outcome is unknown'} (${operationId}); refresh the catalogue before retrying`)
      }
      this.models.bind(params.sessionId ?? undefined, undefined)
      this.operations.finish(operationId, 'applied')
      return this.load(params, signal)
  }

  private async run(params: CatalogRequest, work: (signal: AbortSignal) => Promise<JsonValue>): Promise<JsonValue> {
    if (this.closed) throw new Error('Mon integration is shutting down')
    if (this.sessions.repository.origin !== 'mon') throw new Error('Model catalogue is only available in Mon')
    const controller = new AbortController()
    this.controllers.add(controller)
    const load = () => work(controller.signal)
    const task = params.sessionId ? this.sessions.configureWhileIdle(params.sessionId, load) : load()
    this.tasks.add(task)
    try {
      const result = await task
      this.sessions.resumePending(); return result
    }
    finally { controller.abort(); this.controllers.delete(controller); this.tasks.delete(task) }
  }

  private async load(params: CatalogRequest, signal: AbortSignal): Promise<JsonValue> {
    const sessionId = params.sessionId ?? undefined
    const participants = sessionId ? this.sessions.repository.read(sessionId).participants : []
    const reconcileIdentity = await prepareLegacyIdentity(this.sessions.repository.database, sessionId, params.coreBaseUrl, params.coreToken, signal)
    const saveConnection = () => { reconcileIdentity(); if (sessionId) this.connections!.saveInTransaction(sessionId, { coreBaseUrl: params.coreBaseUrl, coreToken: params.coreToken }) }
    if (sessionId && participants.length > 1) {
      const result = await loadActorCatalog(new MonClient(params.coreBaseUrl, params.coreToken), participants, signal)
      signal.throwIfAborted()
      commitMonModels(this.models, this.sessions.repository, sessionId, { mode: 'multi', director: result.directorBinding.model,
        actors: result.bindings.map(actor => ({ ...actor, vision: actor.vision ?? null })) },
      'session.actor_models.bound', toJson({ actors: result.actors, director: result.catalog.director }), saveConnection)
      return toJson(result.catalog)
    }
    const result = await loadMonCatalog(new MonClient(params.coreBaseUrl, params.coreToken), this.assistantId(sessionId), signal)
    signal.throwIfAborted()
    commitMonModels(this.models, this.sessions.repository, sessionId, { mode: 'single', main: result.binding ?? null,
      vision: result.visionBinding?.model ?? null, visionEntityId: result.visionBinding?.entityId ?? null }, 'model.bound', {
      entityId: result.binding?.entityId ?? null, model: result.binding?.model.id ?? null, provider: result.binding?.model.provider ?? null,
    }, saveConnection)
    return toJson(result.catalog)
  }

  private assistantId(sessionId: string | undefined): string | number | undefined {
    const participants = sessionId ? this.sessions.repository.read(sessionId).participants : []
    if (participants.length > 1) throw new Error('Multi-actor model binding is not migrated yet')
    const first = participants[0]
    const actorId = first && typeof first === 'object' && !Array.isArray(first) ? first.assistantId : undefined
    return typeof actorId === 'string' || typeof actorId === 'number' ? actorId : undefined
  }

  readContactHistory(sessionId: string, raw: unknown, signal: AbortSignal) {
    return readOwnerQqHistory(this.assistantClient(sessionId), raw, signal)
  }

  async contactChannels(sessionId: string, signal: AbortSignal) {
    const client = this.assistantClient(sessionId)
    const results = await Promise.allSettled([ownerQqTarget(client, signal), client.get('/api/agent/external-email/status/', signal)])
    signal.throwIfAborted()
    return toJson({ qq: { available: results[0].status === 'fulfilled' }, email: { statusAvailable: results[1].status === 'fulfilled' } })
  }

  contactOwnerByQq(sessionId: string, raw: unknown, signal: AbortSignal) {
    return deliverOwnerQq(this.sessions.repository.database, this.assistantClient(sessionId), sessionId, raw, signal)
  }

  contactOwnerByEmail(sessionId: string, raw: unknown, signal: AbortSignal) {
    return deliverOwnerEmail(this.sessions.repository.database, this.assistantClient(sessionId), sessionId, raw, signal)
  }

  realtimeSttUrl(sessionId: string): string { return this.assistantClient(sessionId).realtimeSttUrl() }

  async synthesizeSpeech(input: VoiceSynthesizeInput, signal: AbortSignal) {
    const client = this.assistantClient(input.sessionId)
    const connection = this.connections!.read(input.sessionId)!
    const environment = this.sessions.repository.read(input.sessionId).environment
    if (environment && typeof environment === 'object' && !Array.isArray(environment) && environment.sessionPurpose === 'self_awake') {
      throw new Error('Background sessions do not publish a conversational speech projection')
    }
    await this.projection.ensure(client, input.sessionId, JSON.stringify(connection), signal)
    return synthesizeMonSpeech(client, this.operations, input, signal)
  }

  async listAssistants(sessionId: string, signal: AbortSignal) {
    const client = this.assistantClient(sessionId)
    return (await assistantCatalog(client, signal)).map(assistantSummary)
  }

  async resolveAssistant(sessionId: string, target: AssistantTarget, signal: AbortSignal) {
    return resolveAssistantTarget(this.assistantClient(sessionId), target, signal)
  }

  private assistantClient(sessionId: string): MonClient {
    if (this.closed) throw new Error('Mon integration is shutting down')
    this.sessions.repository.read(sessionId)
    const connection = this.connections?.read(sessionId)
    if (!connection) throw new Error('Refresh this session model catalogue to bind Mon credentials')
    return new MonClient(connection.coreBaseUrl, connection.coreToken)
  }

  async prepareHandoff(sessionId: string, assistantId: string | number, signal: AbortSignal) {
    if (this.closed) throw new Error('Mon integration is shutting down')
    const connection = this.connections?.read(sessionId)
    if (!connection) return undefined
    const result = await loadMonCatalog(new MonClient(connection.coreBaseUrl, connection.coreToken), assistantId, signal)
    if (!result.binding) throw new Error('Target assistant has no active model')
    return { binding: result.binding, visionBinding: result.visionBinding }
  }

  replayLegacySync(raw: unknown) {
    const input = monLegacyReplaySchema.parse(raw)
    const connection = this.connections?.read(input.sessionId)
    if (!connection || !this.connections) throw new Error('Verified Mon connection required for historical replay')
    return this.run({ ...connection, sessionId: input.sessionId }, signal => replayLegacyDelivery(this.sessions.repository, this.connections!, input, signal))
  }

  resolveLegacySync(raw: unknown) { return resolveLegacySync(this.sessions.repository, raw) }

  syncStatus(raw: unknown) { return toJson(new MonSyncStatus(this.sessions.repository).read(raw)) }

  startSync() { this.sync?.start() }

  async close(): Promise<void> {
    this.closed = true
    for (const controller of this.controllers) controller.abort()
    await Promise.allSettled([...this.tasks, this.sync?.close()])
  }
}

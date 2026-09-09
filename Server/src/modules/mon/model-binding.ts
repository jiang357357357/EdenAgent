import { MonClient, MonHttpError } from '@eden/integrations'
import { toJson } from '@eden/api'
import type { JsonValue, MonOperationQuery, ModelSelectionTarget, AssistantTarget } from '@eden/api'
import type { ModelService } from '../models/index.ts'
import type { SessionService } from '../sessions/index.ts'
import { loadMonCatalog } from './model-catalog.ts'
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
  private readonly operations: MonOperationRepository
  constructor(private readonly models: ModelService, private readonly sessions: SessionService) {
    this.operations = new MonOperationRepository(sessions.repository)
    this.connections = sessions.repository.origin === 'mon' ? new MonConnectionRepository(sessions.repository.database) : undefined
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

  async select(params: CatalogRequest & { aiEntityId: string | number; target?: ModelSelectionTarget | undefined }): Promise<JsonValue> {
    return this.run(params, signal => {
      const task = this.selectionTail.then(() => this.applySelection(params, signal))
      this.selectionTail = task.then(() => undefined, () => undefined)
      return task
    })
  }

  private async applySelection(params: CatalogRequest & { aiEntityId: string | number; target?: ModelSelectionTarget | undefined }, signal: AbortSignal): Promise<JsonValue> {
      signal.throwIfAborted()
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
    const saveConnection = () => { if (sessionId) this.connections!.saveInTransaction(sessionId, { coreBaseUrl: params.coreBaseUrl, coreToken: params.coreToken }) }
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
      vision: result.visionBinding?.model ?? null }, 'model.bound', {
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

  async close(): Promise<void> {
    this.closed = true
    for (const controller of this.controllers) controller.abort()
    await Promise.allSettled(this.tasks)
  }
}

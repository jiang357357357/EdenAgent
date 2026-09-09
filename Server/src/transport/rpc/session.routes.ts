import { eventListSchema, sessionCreateSchema, sessionIdSchema, sessionListSchema, turnStartSchema, toJson } from '@eden/api'
import { sessionTitleSchema, sessionParticipantsSchema, messageListSchema, sessionCompactSchema, turnQueueSchema } from '@eden/api'
import type { DurableEvent, JsonValue } from '@eden/api'
import type { SessionService } from '../../modules/sessions/index.ts'
import { eventPayload } from './event-payload.ts'
import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import { inputRecoveryRoutes } from './input-recovery.routes.ts'

export function wireEvent(event: DurableEvent): JsonValue {
  return { id: event.id, sessionId: event.sessionId, turnId: event.turnId, seq: event.seq,
    eventType: event.kind, payload: eventPayload(event.payload), createdAt: event.createdAt }
}

export function sessionRoutes(service: SessionService): Record<string, (params: JsonValue) => JsonValue | Promise<JsonValue>> {
  const repository = service.repository
  const handlers: Record<string, (params: JsonValue) => JsonValue | Promise<JsonValue>> = {
    ping: () => ({ pong: true }),
    'tool.list': () => toJson(service.toolCatalog()),
    'session.create': value => {
      const params = sessionCreateSchema.parse(value)
      return toJson(repository.create(params.title, params.participants, toJson(params.environment ?? null)))
    },
    'session.list': value => {
      const params = sessionListSchema.parse(value)
      return toJson(repository.list(params.limit, params.includeClosed, params.includeBackground))
    },
    'session.read': value => toJson(repository.read(sessionIdSchema.parse(value).sessionId)),
    'session.rename': value => { const params = sessionTitleSchema.parse(value); return toJson(repository.rename(params.sessionId, params.title)) },
    'session.set_participants': async value => {
      const params = sessionParticipantsSchema.parse(value)
      return toJson(await service.setParticipants(params.sessionId, params.participants))
    },
    'session.close': async value => { const { sessionId } = sessionIdSchema.parse(value); await service.endSession(sessionId, 'closed'); return { sessionId, closed: true } },
    'session.delete': async value => { const { sessionId } = sessionIdSchema.parse(value); await service.endSession(sessionId, 'deleted'); return { sessionId, deleted: true } },
    'session.compact': value => {
      const params = sessionCompactSchema.parse(value)
      return toJson(service.start(params.sessionId, params.instructions, undefined, undefined, 'compact'))
    },
    'turn.start': value => {
      const params = turnStartSchema.parse(value)
      if (params.attachments.length) return service.startWithAttachments(params.sessionId, params.text, params.attachments,
        params.idempotencyKey, params.environment === undefined ? undefined : toJson(params.environment)).then(toJson)
      return toJson(service.start(params.sessionId, params.text, params.idempotencyKey, params.environment === undefined ? undefined : toJson(params.environment)))
    },
    'turn.cancel': async value => {
      const { sessionId } = sessionIdSchema.parse(value)
      return { sessionId, cancellationRequested: await service.cancel(sessionId) }
    },
    'turn.steer': async value => { const params = turnQueueSchema.parse(value); return toJson(await service.inject(params.sessionId, params.text, 'steer')) },
    'turn.follow_up': async value => { const params = turnQueueSchema.parse(value); return toJson(await service.inject(params.sessionId, params.text, 'follow_up')) },
    'event.list': value => {
      const params = eventListSchema.parse(value)
      repository.read(params.sessionId)
      const items = repository.events.list(params.sessionId, String(params.afterSeq), params.limit + 1)
      const page = items.slice(0, params.limit)
      return { items: page.map(wireEvent), hasMore: items.length > params.limit, nextCursor: page.at(-1)?.seq ?? null }
    },
    'message.list': value => {
      const params = messageListSchema.parse(value)
      repository.read(params.sessionId)
      const page = repository.events.messages(params.sessionId, params.before ?? undefined, params.limit)
      return { ...page, items: page.items.map(wireEvent) }
    },
  }
  return { ...inputRecoveryRoutes(repository, service), ...Object.fromEntries(Object.entries(handlers).map(([method, handler]) => {
    if (!Object.hasOwn(rpcMethods, method)) throw new Error(`Missing session RPC contract: ${method}`)
    const contract = rpcMethods[method as keyof typeof rpcMethods]
    return [method, contractHandler(contract, input => handler(toJson(input)))]
  })) }
}

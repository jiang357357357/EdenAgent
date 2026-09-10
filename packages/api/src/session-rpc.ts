import { z } from 'zod'
import { inputRecoveryMethods } from './input-recovery.ts'
import { jsonValue } from './json.ts'
import { runtimeOriginSchema } from './runtime.ts'
import { sessionCreateSchema, sessionListSchema, sessionIdSchema, sessionTitleSchema, sessionParticipantsSchema } from './rpc.ts'
import { eventListSchema, messageListSchema } from './rpc.ts'

export const sessionSummarySchema = z.object({
  id: z.string().uuid(), title: z.string(), titleSource: z.string(),
  status: z.enum(['active', 'closed']), runtimeOrigin: runtimeOriginSchema,
  participants: z.array(jsonValue), environment: jsonValue,
  contextTokens: z.number().int().nonnegative().nullish(), tokenBreakdown: jsonValue.optional(),
  createdAt: z.number().int(), updatedAt: z.number().int(),
})
export type SessionSummary = z.infer<typeof sessionSummarySchema>
export const sessionEventSchema = z.object({
  id: z.string().uuid(), sessionId: z.string().uuid(), turnId: z.string().uuid().nullable(),
  seq: z.string().regex(/^[1-9]\d*$/), eventType: z.string(), payload: jsonValue, createdAt: z.number().int(),
})
export type SessionEvent = z.infer<typeof sessionEventSchema>
const eventPageSchema = z.object({ items: z.array(sessionEventSchema), hasMore: z.boolean(), nextCursor: z.string().nullable() })
export const sessionRpcMethods = {
  ...inputRecoveryMethods,
  'session.create': { params: sessionCreateSchema, result: sessionSummarySchema },
  'session.list': { params: sessionListSchema, result: z.array(sessionSummarySchema) },
  'session.read': { params: sessionIdSchema, result: sessionSummarySchema },
  'session.rename': { params: sessionTitleSchema, result: sessionSummarySchema },
  'session.set_participants': { params: sessionParticipantsSchema, result: sessionSummarySchema },
  'event.list': { params: eventListSchema, result: eventPageSchema },
  'message.list': { params: messageListSchema, result: eventPageSchema },
} as const

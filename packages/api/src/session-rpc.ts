import { z } from 'zod'
import { inputRecoveryMethods } from './input-recovery.ts'
import { jsonValue } from './json.ts'
import { runtimeOriginSchema } from './runtime.ts'
import { sessionPurposeSchema, sessionSourceChannelSchema } from './session-classification.ts'
import { sessionCreateSchema, sessionListSchema, sessionIdSchema, sessionTitleSchema, sessionParticipantsSchema } from './rpc.ts'
import { eventListSchema, messageListSchema } from './rpc.ts'
import { replyTimerSnapshotSchema } from './session-timing.ts'

export const sessionSummarySchema = z.object({
  id: z.string().uuid(), title: z.string(), titleSource: z.string(),
  status: z.enum(['active', 'closed']), executionStatus: z.enum(['idle', 'busy']), runtimeOrigin: runtimeOriginSchema,
  archived: z.boolean().default(false),
  pinned: z.boolean().default(false), pinUpdatedAt: z.number().int().nonnegative().default(0),
  purpose: sessionPurposeSchema.default('user_chat'), sourceChannel: sessionSourceChannelSchema.default('app'),
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
  'session.timing.read': { params: sessionIdSchema, result: replyTimerSnapshotSchema },
  'session.context': { params: sessionIdSchema, result: z.object({ requests: z.array(sessionEventSchema) }) },
  'session.rename': { params: sessionTitleSchema, result: sessionSummarySchema },
  'session.set_archived': { params: sessionIdSchema.extend({ archived: z.boolean() }), result: sessionSummarySchema },
  'session.set_pinned': { params: sessionIdSchema.extend({ pinned: z.boolean() }), result: sessionSummarySchema },
  'session.set_participants': { params: sessionParticipantsSchema, result: sessionSummarySchema },
  'event.list': { params: eventListSchema, result: eventPageSchema },
  'message.list': { params: messageListSchema, result: eventPageSchema },
  'message.delete': {
    params: z.object({ sessionId: z.string().uuid(), messageId: z.string().min(1).max(200), scope: z.enum(['message', 'reply']).optional() }).strict(),
    result: z.object({ sessionId: z.string().uuid(), messageId: z.string(), deleted: z.literal(true), messageIds: z.array(z.string()).optional() }),
  },
  'message.reply.read': {
    params: z.object({ sessionId: z.string().uuid(), messageId: z.string().min(1).max(200) }).strict(),
    result: z.object({ sessionId: z.string().uuid(), messageId: z.string(), messageIds: z.array(z.string()), text: z.string() }),
  },
} as const

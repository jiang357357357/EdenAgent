import { z } from 'zod'
import { sessionIdSchema, sessionCompactSchema, turnStartSchema, turnQueueSchema } from './rpc.ts'
export const acceptedInputSchema = z.object({ sessionId: z.string().uuid(), turnId: z.string().uuid(), inputId: z.string().uuid(), state: z.string() })
export const turnRpcMethods = {
  ping: { params: z.object({}).strict(), result: z.object({ pong: z.literal(true) }) },
  'session.close': { params: sessionIdSchema, result: z.object({ sessionId: z.string().uuid(), closed: z.literal(true) }) },
  'session.delete': { params: sessionIdSchema, result: z.object({ sessionId: z.string().uuid(), deleted: z.literal(true) }) },
  'session.compact': { params: sessionCompactSchema, result: acceptedInputSchema },
  'turn.start': { params: turnStartSchema, result: acceptedInputSchema },
  'turn.cancel': { params: sessionIdSchema, result: z.object({ sessionId: z.string().uuid(), cancellationRequested: z.boolean() }) },
  'turn.steer': { params: turnQueueSchema, result: acceptedInputSchema },
  'turn.follow_up': { params: turnQueueSchema, result: acceptedInputSchema },
} as const

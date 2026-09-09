import { z } from 'zod'
export const agentReadSchema = z.object({ agentId: z.uuid() }).strict()
export const agentListSchema = z.object({ sessionId: z.uuid() }).strict()
export const agentMessageSchema = agentReadSchema.extend({ message: z.string().min(1).max(64000) })
export const agentSpawnSchema = z.object({ sessionId: z.uuid(), taskName: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  maxTokens: z.number().int().min(1).max(100000000).default(1000000),
  maxCostMicrousd: z.number().int().min(1).max(1000000000).nullable().default(null),
  maxModelRequests: z.number().int().min(1).max(128).default(128), maxToolCalls: z.number().int().min(1).max(256).default(256),
  maxTurns: z.number().int().min(1).max(32).default(8), timeoutMs: z.number().int().min(1000).max(86400000).default(1800000),
  message: z.string().min(1).max(64000), role: z.string().max(256).default('worker'), idempotencyKey: z.string().min(1).max(256),
}).strict()

export const agentMessageRequestSchema = agentMessageSchema.extend({ idempotencyKey: z.string().min(1).max(256).optional() })

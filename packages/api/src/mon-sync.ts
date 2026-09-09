import { jsonValue } from './json.ts'
import { z } from 'zod'
export const monSyncStatusSchema = z.object({ sessionId: z.string().uuid(), before: z.number().int().positive().safe().optional(),
  legacyBefore: z.number().int().positive().safe().optional(), limit: z.number().int().min(1).max(100).default(30) }).strict()
const legacySyncSchema = z.object({ identityState: z.string().nullable(), blocked: z.boolean(), totals: z.record(z.string(), z.number()),
  items: z.array(z.object({ id: z.number().int().positive().safe(), kind: z.string(), state: z.string(), attempts: z.number().int(),
    review: z.object({ decision: z.enum(['confirm_completed', 'abandon']), note: z.string(), createdAt: z.number() }).nullable(),
    error: z.string().nullable(), createdAt: z.number(), updatedAt: z.number() })), nextCursor: z.number().nullable() })
export const monSyncResultSchema = z.object({ legacy: legacySyncSchema, bound: z.boolean(), totals: z.record(z.string(), z.number()),
  contacts: z.array(z.object({ requestId: z.string(), channel: z.string(), state: z.string(), error: z.string().nullable(), updatedAt: z.number() })),
  progress: z.array(z.object({ afterSeq: z.string(), attempts: z.number(), retryAt: z.number(), error: z.string().nullable() })),
  items: z.array(z.object({ id: z.string(), kind: z.string(), state: z.string(), remoteId: z.string().nullable(), error: z.string().nullable(), createdAt: z.number(), updatedAt: z.number() })),
  nextCursor: z.number().nullable() })
export type MonSyncResult = z.infer<typeof monSyncResultSchema>

export const monLegacySyncResolveSchema = z.object({ sessionId: z.uuid(), id: z.number().int().positive().safe(),
  decision: z.enum(['confirm_completed', 'abandon']), note: z.string().trim().min(1).max(2000) }).strict()
export const monLegacySyncResolveResultSchema = z.object({ id: z.number().int().positive().safe(), state: z.string(), decision: z.enum(['confirm_completed', 'abandon']) })

export const monLegacyReplaySchema = z.object({ sessionId: z.uuid(), id: z.number().int().positive().safe(),
  requestKey: z.uuid(), note: z.string().trim().min(1).max(2000), confirm: z.literal(true) }).strict()
export const monLegacyReplayResultSchema = z.object({ requestKey: z.uuid(), id: z.number().int().positive().safe(), sessionId: z.uuid(),
  state: z.enum(['running', 'unknown', 'completed']), note: z.string(), result: jsonValue, error: z.string().nullable(), createdAt: z.number(), updatedAt: z.number() })

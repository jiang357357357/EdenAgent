import { z } from 'zod'
import { jsonValue } from './json.ts'
import { selfAwakeListSchema, selfAwakeExecutionSchema } from './self-awake.ts'
export const selfAwakeRunInfoSchema = z.object({
  id: z.string().uuid(), jobId: z.string().uuid(), sessionId: z.string().uuid(), schemaVersion: z.literal('self-awake.v1'), eventId: z.string(),
  status: z.string(), request: jsonValue, decision: jsonValue, authorSnapshot: jsonValue, attempts: z.number().int(), lastError: z.string().nullable(),
  startedAt: z.number().int().nullable(), completedAt: z.number().int().nullable(), createdAt: z.number().int(), updatedAt: z.number().int(),
  diaries: z.array(z.object({ id: z.string().uuid(), runId: z.string().uuid(), sessionId: z.string().uuid(), assistantId: z.string(), characterId: z.string(),
    title: z.string(), content: z.string(), mood: z.string(), metadata: jsonValue, createdAt: z.number().int() })),
})
export type SelfAwakeRunInfo = z.infer<typeof selfAwakeRunInfoSchema>
export const selfAwakeRpcMethods = {
  'self_awake.list': { params: selfAwakeListSchema, result: z.object({
    schedule: z.object({ status: z.literal('scheduled'), nextWakeAt: z.string(), reason: z.string() }).nullable(),
    count: z.number().int(), page: z.number().int(), pageSize: z.number().int(), totalPages: z.number().int(), results: z.array(selfAwakeRunInfoSchema),
  }) },
  'self_awake.execution': { params: selfAwakeExecutionSchema, result: z.object({ path: z.string(), record: jsonValue }) },
  'self_awake.action.resume': { params: selfAwakeExecutionSchema, result: z.object({ runId: z.string().uuid(), state: z.literal('accepted') }) },
} as const

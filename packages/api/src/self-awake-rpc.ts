import { z } from 'zod'
import { jsonValue } from './json.ts'
import { jobIdSchema, jobInfoSchema } from './jobs.ts'
import { selfAwakeListSchema, selfAwakeExecutionSchema } from './self-awake.ts'
export const selfAwakeRunInfoSchema = z.object({
  scheduledWake: z.object({ id: z.uuid(), dueAt: z.number().int(), createdAt: z.number().int(),
    state: jobInfoSchema.shape.state, reason: z.string() }).nullable().optional(),
  outcomeReview: z.object({ decision: z.string(), note: z.string(), reviewedAt: z.number() }).nullable().optional(),
  id: z.string().uuid(), jobId: z.string().uuid(), sessionId: z.string().uuid(), schemaVersion: z.literal('self-awake.v1'), eventId: z.string(),
  status: z.string(), request: jsonValue, decision: jsonValue, authorSnapshot: jsonValue, attempts: z.number().int(), lastError: z.string().nullable(),
  startedAt: z.number().int().nullable(), completedAt: z.number().int().nullable(), createdAt: z.number().int(), updatedAt: z.number().int(),
  diaries: z.array(z.object({ id: z.string().uuid(), runId: z.string().uuid(), sessionId: z.string().uuid(), assistantId: z.string(), characterId: z.string(),
    title: z.string(), content: z.string(), mood: z.string(), metadata: jsonValue, createdAt: z.number().int() })),
})
export type SelfAwakeRunInfo = z.infer<typeof selfAwakeRunInfoSchema>
const notificationReviewSchema = z.object({ fingerprint: z.string(), record: jsonValue, state: z.string() })
export const selfAwakeRpcMethods = {
  'self_awake.run.review': { params: selfAwakeExecutionSchema, result: z.object({ fingerprint: z.string(), state: z.string() }) },
  'self_awake.run.resolve': { params: selfAwakeExecutionSchema.extend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(['completed', 'failed']), note: z.string().trim().min(1).max(4000), confirmOutcome: z.literal(true) }), result: z.object({ fingerprint: z.string(), state: z.string() }) },
  'self_awake.notification.review': { params: selfAwakeExecutionSchema, result: notificationReviewSchema.nullable() },
  'self_awake.notification.resolve': { params: selfAwakeExecutionSchema.extend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(['delivered', 'suppressed']), note: z.string().trim().min(1).max(4000), confirmOutcome: z.literal(true) }), result: notificationReviewSchema },
  'self_awake.job.preview': { params: jobIdSchema, result: z.object({ fingerprint: z.string(), job: jobInfoSchema,
    runId: z.uuid().nullable(), author: jsonValue, environment: jsonValue }) },
  'self_awake.job.resubmit': { params: jobIdSchema.extend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    note: z.string().trim().min(1).max(4000), confirmResubmit: z.literal(true) }), result: jobInfoSchema },
  'self_awake.list': { params: selfAwakeListSchema, result: z.object({
    schedule: z.object({ status: z.enum(['scheduled', 'disabled', 'unscheduled', 'retrying']), nextWakeAt: z.string().nullable(), reason: z.string() }).nullable(),
    count: z.number().int(), page: z.number().int(), pageSize: z.number().int(), totalPages: z.number().int(), results: z.array(selfAwakeRunInfoSchema),
  }) },
  'self_awake.execution': { params: selfAwakeExecutionSchema, result: z.object({ path: z.string(), record: jsonValue }) },
  'self_awake.action.resume': { params: selfAwakeExecutionSchema, result: z.object({ runId: z.string().uuid(), state: z.literal('accepted') }) },
} as const

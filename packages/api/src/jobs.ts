import { z } from 'zod'
import { jsonValue } from './json.ts'

const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const jobScheduleSchema = z.object({
  kind: z.string().min(1).max(100), sessionId: z.uuid().nullable().default(null), dueAt: timestamp,
  payload: jsonValue.refine(value => JSON.stringify(value).length <= 65536, 'Job payload too large'),
  key: z.string().min(1).max(512), causationId: z.string().max(512).default(''), depth: z.number().int().min(0).max(8).default(0),
}).strict()
export const jobInfoSchema = jobScheduleSchema.extend({
  id: z.uuid(), state: z.enum(['queued', 'running', 'dispatched', 'completed', 'failed', 'cancelled', 'unknown']),
  attempts: z.number().int().nonnegative(), error: z.string().nullable(), inputId: z.uuid().nullable(),
  createdAt: timestamp, updatedAt: timestamp,
})
export const jobListSchema = z.object({ sessionId: z.uuid().optional(), state: jobInfoSchema.shape.state.optional(), limit: z.number().int().min(1).max(200).default(80) }).strict()
export const jobIdSchema = z.object({ id: z.uuid() }).strict()
export const jobCursorSchema = z.object({ createdAt: timestamp, id: z.uuid() }).strict()
export const jobPageSchema = z.object({ sessionId: z.uuid().optional(), kind: z.string().min(1).max(100).optional(),
  states: z.array(jobInfoSchema.shape.state).min(1).max(7).optional(), before: jobCursorSchema.optional(),
  limit: z.number().int().min(1).max(20).default(20) }).strict()
export type JobCursor = z.infer<typeof jobCursorSchema>
export type JobSchedule = z.infer<typeof jobScheduleSchema>
export type JobInfo = z.infer<typeof jobInfoSchema>

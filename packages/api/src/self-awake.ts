import { z } from 'zod'
import { jsonValue } from './json.ts'
import { memoIntegerSchema } from './memos.ts'

export const selfAwakeListSchema = z.object({ page: z.number().int().min(1).max(100000).default(1), pageSize: z.number().int().min(1).max(100).default(20), query: z.string().max(1000).nullish() }).strict()
export const selfAwakeExecutionSchema = z.object({ runId: z.uuid() }).strict()
export const selfAwakeTimerSchema = z.object({
  afterMinutes: z.number().int().min(1).max(10080).optional(),
  at: z.union([memoIntegerSchema, z.string().refine(value => Number.isFinite(Date.parse(value)), 'Invalid date').transform(value => Date.parse(value))]).optional(),
  reason: z.string().trim().min(1).max(4000).default('Scheduled self-awake activation'),
}).strict().refine(value => value.at !== undefined || value.afterMinutes !== undefined, 'at or afterMinutes is required')
export const selfAwakeDecisionSchema = z.object({
  mood: z.string().max(1000), current_desire: z.string().max(4000), observations: z.array(z.string().max(4000)).max(5),
  should_interrupt_user: z.boolean(), action: z.enum(['chat_user', 'remind_user', 'create_task', 'ask_user', 'run_safe_check', 'sync_context', 'write_diary']),
  action_payload: jsonValue, next_wake: z.object({ after_minutes: z.number().int().min(1).max(10080), reason: z.string().min(1).max(4000) }).strict(),
  diary: z.object({ title: z.string().trim().min(1).max(1000), content: z.string().trim().min(1).max(32000) }).strict(),
}).strict()
export type SelfAwakeDecision = z.infer<typeof selfAwakeDecisionSchema>

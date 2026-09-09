import { z } from 'zod'
import { jsonValue } from './json.ts'

export const memoIntegerSchema = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER))
export const memoIdSchema = z.object({ id: memoIntegerSchema.refine(value => value > 0) }).strict()
const fields = {
  title: z.string().trim().min(1).max(1000), content: z.string().max(64000),
  kind: z.enum(['note', 'reminder', 'todo']), status: z.enum(['active', 'done', 'archived', 'cancelled']),
  priority: z.enum(['low', 'normal', 'high']), remindAt: memoIntegerSchema.nullable(), dueAt: memoIntegerSchema.nullable(),
  snoozedUntil: memoIntegerSchema.nullable(), repeatRule: z.string().max(1000), metadata: jsonValue.refine(value => JSON.stringify(value).length <= 65536, 'Memo metadata is too large'),
}
export const memoCreateSchema = z.object({
  ...fields, content: fields.content.default(''), kind: fields.kind.default('note'), status: fields.status.default('active'),
  priority: fields.priority.default('normal'), remindAt: fields.remindAt.default(null), dueAt: fields.dueAt.default(null),
  snoozedUntil: fields.snoozedUntil.default(null), repeatRule: fields.repeatRule.default(''), metadata: fields.metadata.default({}),
  relatedSessionId: z.union([z.literal(''), z.uuid()]).default(''),
}).strict()
export const memoPatchSchema = z.object(fields).partial().strict()
export const memoUpdateSchema = memoIdSchema.extend({ patch: memoPatchSchema })
export const memoListSchema = z.object({ limit: z.number().int().min(1).max(200).default(80), query: z.string().max(1000).nullish() }).strict()
export const memoInfoSchema = memoCreateSchema.extend({
  source: z.string().default('monagent'), id: memoIntegerSchema, lastTriggeredAt: memoIntegerSchema.nullable(), completedAt: memoIntegerSchema.nullable(),
  createdAt: memoIntegerSchema, updatedAt: memoIntegerSchema,
})
export type MemoInput = z.infer<typeof memoCreateSchema>
export type MemoPatch = z.infer<typeof memoPatchSchema>
export type MemoInfo = z.infer<typeof memoInfoSchema>
export const memoNotificationSchema = z.object({
  id: z.uuid(), jobId: z.uuid(), memo: memoInfoSchema, createdAt: memoIntegerSchema, readAt: memoIntegerSchema.nullable(),
}).strict()
export const memoNotificationListSchema = z.object({ limit: z.number().int().min(1).max(200).default(80) }).strict()
export const memoNotificationIdSchema = z.object({ id: z.uuid() }).strict()
export const memoNotificationListResultSchema = z.array(memoNotificationSchema)
export type MemoNotification = z.infer<typeof memoNotificationSchema>

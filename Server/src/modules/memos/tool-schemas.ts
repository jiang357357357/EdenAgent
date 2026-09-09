import { z } from 'zod'
import { memoCreateSchema, memoIdSchema, memoIntegerSchema, memoListSchema, memoUpdateSchema } from '@eden/api'

const timestamp = z.union([memoIntegerSchema, z.string().refine(value => Number.isFinite(Date.parse(value)), 'Expected an ISO date').transform(value => Date.parse(value))])
const create = memoCreateSchema.omit({ relatedSessionId: true }).extend({ remindAt: timestamp.nullable().optional(), dueAt: timestamp.nullable().optional() })
const due = z.object({ before: timestamp.optional(), limit: memoListSchema.shape.limit }).strict()
export const memoToolSchemas = {
  create_memo: create,
  create_reminder: create.extend({ remindAt: timestamp }),
  list_memos: memoListSchema,
  list_due_memos: due,
  update_memo: memoUpdateSchema,
  complete_memo: memoIdSchema,
  archive_memo: memoIdSchema,
  snooze_memo: memoIdSchema.extend({ until: timestamp.optional(), minutes: z.number().int().min(1).max(525600).optional() })
    .refine(input => input.until !== undefined || input.minutes !== undefined, 'until or minutes is required'),
  mark_memo_triggered: memoIdSchema,
  dispatch_due_memos: due.extend({ markDispatched: z.boolean().default(false) }),
  get_next_memo_wake: z.object({ after: timestamp.optional() }).strict(),
}
export type MemoToolName = keyof typeof memoToolSchemas

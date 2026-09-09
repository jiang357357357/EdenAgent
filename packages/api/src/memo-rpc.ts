import { z } from 'zod'
import { memoInfoSchema, memoCreateSchema, memoUpdateSchema, memoListSchema, memoIdSchema,
  memoNotificationListSchema, memoNotificationListResultSchema, memoNotificationIdSchema } from './memos.ts'
import { jobListSchema, jobIdSchema, jobInfoSchema } from './jobs.ts'
export const memoRpcMethods = {
  'memo.list': { params: memoListSchema, result: z.array(memoInfoSchema) },
  'memo.create': { params: memoCreateSchema, result: memoInfoSchema },
  'memo.update': { params: memoUpdateSchema, result: memoInfoSchema },
  'memo.complete': { params: memoIdSchema, result: memoInfoSchema },
  'memo.archive': { params: memoIdSchema, result: memoInfoSchema },
  'memo.notification.list': { params: memoNotificationListSchema, result: memoNotificationListResultSchema },
  'memo.notification.acknowledge': { params: memoNotificationIdSchema, result: z.object({ id: z.uuid(), acknowledged: z.literal(true) }) },
  'job.list': { params: jobListSchema, result: z.array(jobInfoSchema) },
  'job.read': { params: jobIdSchema, result: jobInfoSchema },
  'job.cancel': { params: jobIdSchema, result: jobInfoSchema },
} as const

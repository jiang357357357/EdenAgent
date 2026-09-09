import { z } from 'zod'
import { jsonValue } from './json.ts'

export const monOperationStateSchema = z.enum(['running', 'applied', 'unknown', 'failed'])
export const monOperationListSchema = z.object({
  sessionId: z.string().uuid().nullish(),
  state: monOperationStateSchema.nullish(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict()
export type MonOperationQuery = z.infer<typeof monOperationListSchema>
export const monOperationInfoSchema = z.object({ operationId: z.string().uuid(), sessionId: z.string().uuid().nullable(), kind: z.string(), endpoint: z.string(),
  request: jsonValue, state: monOperationStateSchema, error: z.string().nullable(), createdAt: z.number(), updatedAt: z.number() })

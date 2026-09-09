import { z } from 'zod'

export const monOperationStateSchema = z.enum(['running', 'applied', 'unknown', 'failed'])
export const monOperationListSchema = z.object({
  sessionId: z.string().uuid().nullish(),
  state: monOperationStateSchema.nullish(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict()
export type MonOperationQuery = z.infer<typeof monOperationListSchema>

import { z } from 'zod'
export const connectorHistorySchema = z.object({ id: z.string().uuid(), before: z.number().int().positive().safe().optional(),
  limit: z.number().int().min(1).max(100).default(30) }).strict()
export const connectorOperationPageSchema = z.object({ items: z.array(z.object({ id: z.string(), sessionId: z.string(), generation: z.string(), method: z.string(),
  state: z.enum(['running', 'completed', 'failed', 'unknown']), error: z.string().nullable(), createdAt: z.number(), updatedAt: z.number() })), nextCursor: z.number().nullable() })
export type ConnectorOperationPage = z.infer<typeof connectorOperationPageSchema>

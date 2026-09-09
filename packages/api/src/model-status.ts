import { z } from 'zod'
const identity = z.union([z.string(), z.number().int().safe()]).nullable()
const status = z.object({ id: z.string(), provider: z.string(), api: z.string(), baseUrl: z.string().nullable(), contextWindow: z.number().nullable(),
  maxTokens: z.number().nullable(), source: z.enum(['env', 'core']), aiEntityId: identity, label: z.string(), available: z.boolean(), error: z.string().nullable() })
export const modelStatusSchema = status.extend({ mode: z.literal('multi_actor').optional(),
  actors: z.array(status.extend({ assistantID: identity })).optional(), director: status.optional() })
export type ModelStatus = z.infer<typeof modelStatusSchema>

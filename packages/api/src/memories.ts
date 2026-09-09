import { z } from 'zod'
import { jsonValue } from './json.ts'

export const memoryKindSchema = z.enum(['preference', 'fact', 'decision', 'procedure'])
export const memoryScopeSchema = z.object({ scopeType: z.literal('agent_character'), scopeKey: z.string().trim().min(1).max(256) }).strict()
export const memoryRecordSchema = memoryScopeSchema.extend({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  content: z.string().min(1).max(16000), kind: memoryKindSchema,
  sourceSessionId: z.union([z.literal(''), z.uuid()]), metadata: jsonValue,
  createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  updatedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})
export type MemoryScope = z.infer<typeof memoryScopeSchema>
export type MemoryRecord = z.infer<typeof memoryRecordSchema>
export type MemoryKind = z.infer<typeof memoryKindSchema>

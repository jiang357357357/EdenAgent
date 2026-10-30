import { z } from 'zod'

export const modelContextLimitReadSchema = z.object({ sessionId: z.uuid() }).strict()
export const modelContextLimitInfoSchema = z.object({
  contextWindow: z.number().int().positive(), defaultContextWindow: z.number().int().positive(),
  minContextWindow: z.number().int().positive(), maxOutputTokens: z.number().int().positive(),
  inputBudget: z.number().int().nonnegative(), override: z.number().int().positive().nullable(),
  modelKey: z.string().length(64), revision: z.uuid().nullable(),
})
export const modelContextLimitSetSchema = modelContextLimitReadSchema.extend({
  contextWindow: z.number().int().positive().max(10_000_000).nullable(),
  expectedModelKey: z.string().length(64), expectedRevision: z.uuid().nullable(),
}).strict()

import { z } from 'zod'
import { actorIdSchema } from './director.ts'
export const modelRatesSchema = z.object({ input: z.number().finite().nonnegative(), output: z.number().finite().nonnegative(),
  cacheRead: z.number().finite().nonnegative(), cacheWrite: z.number().finite().nonnegative() }).strict()
export const modelPricingTargetSchema = z.object({ sessionId: z.string().uuid(),
  target: z.enum(['main', 'vision', 'director', 'actor', 'actor_vision']), assistantId: actorIdSchema.optional() }).strict()
  .refine(value => (value.target === 'actor' || value.target === 'actor_vision') === (value.assistantId !== undefined), 'Actor targets require an assistant ID')
export const modelPricingInfoSchema = z.object({ modelKey: z.string(), provider: z.string(), modelId: z.string(),
  rates: modelRatesSchema.nullable(), revision: z.string().uuid().nullable() })
export const modelPricingSetSchema = z.object({ selection: modelPricingTargetSchema, expectedModelKey: z.string().length(64),
  expectedRevision: z.string().uuid().nullable(), rates: modelRatesSchema.nullable(), note: z.string().trim().min(1).max(4000) }).strict()
export type ModelRates = z.infer<typeof modelRatesSchema>
export type ModelPricingTarget = z.infer<typeof modelPricingTargetSchema>

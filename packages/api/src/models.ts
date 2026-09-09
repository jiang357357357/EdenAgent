import { z } from 'zod'

export const modelEndpointSchema = z.string().url().superRefine((value, context) => {
  const endpoint = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) context.addIssue({ code: 'custom', message: 'Model endpoint requires HTTPS or loopback HTTP' })
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) context.addIssue({ code: 'custom', message: 'Model endpoint cannot embed credentials, query parameters or fragments' })
})
export const configuredModelSchema = z.object({
  provider: z.string().min(1).max(100), id: z.string().min(1).max(500), baseUrl: modelEndpointSchema,
  apiKey: z.string().min(1).optional(), contextWindow: z.number().int().positive(), maxTokens: z.number().int().positive(),
  reasoning: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  cost: z.object({ input: z.number().nonnegative().finite(), output: z.number().nonnegative().finite(),
    cacheRead: z.number().nonnegative().finite(), cacheWrite: z.number().nonnegative().finite() }).strict().optional(),
}).strict().refine(value => value.maxTokens <= value.contextWindow, 'Model output budget exceeds its context window')
  .transform(({ apiKey, ...config }) => ({ ...config, ...(apiKey ? { apiKey } : {}) }))
export const modelReadSchema = z.object({ sessionId: z.string().uuid().nullish() }).strict()
export const modelCatalogSchema = modelReadSchema.extend({ coreBaseUrl: modelEndpointSchema, coreToken: z.string().trim().min(1).max(8192) })
export const modelSelectionTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('director') }).strict(),
  z.object({ kind: z.literal('actor'), assistantId: z.union([z.string().min(1).max(200), z.number().int().safe()]) }).strict(),
])
export type ModelSelectionTarget = z.infer<typeof modelSelectionTargetSchema>
export const modelSelectSchema = modelCatalogSchema.extend({ aiEntityId: z.union([z.string().min(1).max(200), z.number().int().safe()]), target: modelSelectionTargetSchema.optional() })

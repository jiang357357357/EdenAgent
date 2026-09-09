import { z } from 'zod'
import { configuredModelSchema } from '@eden/api'

export const coreIdSchema = z.union([z.string().min(1).max(200), z.number().int().safe()])
export const coreEntitySchema = z.object({
  id: coreIdSchema, ai_model: z.string().min(1), vendor: z.string().min(1), ai_name: z.string().default(''),
  status: z.string(), is_multimodal: z.boolean().default(false), is_choice_default: z.boolean().default(false), is_vision_default: z.boolean().default(false),
  default_params: z.object({ context_window: z.coerce.number().int().positive().default(128000), max_tokens: z.coerce.number().int().positive().default(16384) }).passthrough().default({ context_window: 128000, max_tokens: 16384 }),
}).passthrough()
export const coreDetailSchema = coreEntitySchema.extend({ api_key: z.string().min(1), api_endpoint: z.string().min(1) })
export const coreAssistantSchema = z.object({ id: coreIdSchema, name: z.string().default(''), character: z.object({
  id: coreIdSchema, name: z.string().default(''), ai_talk_entity_id: coreIdSchema.nullish(), vision_ai_entity_id: coreIdSchema.nullish(),
}).passthrough() }).passthrough()
export const coreSettingsSchema = z.object({ default_model: coreIdSchema.nullish() }).passthrough()
export type CoreEntity = z.infer<typeof coreEntitySchema>

export function parseCoreAssistant(raw: unknown, expectedId?: string | number) {
  const assistant = coreAssistantSchema.parse(raw)
  if (expectedId !== undefined && String(assistant.id) !== String(expectedId)) throw new Error('Mon assistant detail identity mismatch')
  return assistant
}

export function resolveCoreModel(raw: unknown) {
  const entity = coreDetailSchema.parse(raw)
  if (entity.status !== 'active') throw new Error('Selected Mon model is inactive')
  const model = configuredModelSchema.parse({ provider: entity.vendor, id: entity.ai_model, apiKey: entity.api_key,
    baseUrl: entity.api_endpoint, contextWindow: entity.default_params.context_window, maxTokens: entity.default_params.max_tokens })
  return { entityId: entity.id, label: entity.ai_name || entity.ai_model, model }
}

export function coreEntities(raw: unknown): CoreEntity[] {
  return z.array(coreEntitySchema).parse(raw)
}

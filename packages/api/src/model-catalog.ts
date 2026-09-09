import { z } from 'zod'
const id = z.union([z.string(), z.number().int().safe()])
const identity = z.object({ id, name: z.string() })
export const modelOptionSchema = z.object({ id: z.string(), aiEntityId: id, label: z.string(), name: z.string(), provider: z.string(), providerName: z.string(),
  providerIcon: z.string(), supportedModels: z.array(z.string()), modelID: z.string(), status: z.string(), isMultimodal: z.boolean(), isChoiceDefault: z.boolean(),
  isVisionDefault: z.boolean(), contextWindow: z.number().nullable().optional(), selected: z.boolean() })
export const modelCatalogResultSchema = z.object({ source: z.literal('core'), serviceType: z.literal('ai'),
  vendors: z.record(z.string(), z.object({ name: z.string(), icon: z.string(), models: z.array(z.string()) })),
  assistant: identity.nullable(), character: identity.nullable(), current: modelOptionSchema.nullable(), vision: modelOptionSchema.nullable(),
  director: modelOptionSchema.nullable().optional(), selectionSource: z.enum(['actors', 'character', 'input']), options: z.array(modelOptionSchema),
  actors: z.array(z.object({ assistantId: id, assistantName: z.string(), characterId: id, main: modelOptionSchema.nullable(), vision: modelOptionSchema.nullable() })) })

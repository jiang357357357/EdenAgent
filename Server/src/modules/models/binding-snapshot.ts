import { z } from 'zod'
import { configuredModelSchema, actorIdSchema } from '@eden/api'

const binding = z.object({ model: configuredModelSchema, entityId: actorIdSchema, label: z.string().max(1000) }).strict()
const actor = z.object({ assistantId: actorIdSchema, characterId: actorIdSchema, main: binding, vision: binding.nullable() }).strict()
export const modelBindingSnapshotSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('single'), main: binding.nullable(), vision: configuredModelSchema.nullable(), visionEntityId: actorIdSchema.nullable().optional() }).strict(),
  z.object({ mode: z.literal('multi'), actors: z.array(actor).min(1).max(32), director: configuredModelSchema.nullable() }).strict(),
]).superRefine((value, context) => {
  if (value.mode === 'single' && value.vision === null && value.visionEntityId != null)
    context.addIssue({ code: 'custom', message: 'Vision entity requires a vision model' })
  if (value.mode === 'multi' && new Set(value.actors.map(item => String(item.assistantId))).size !== value.actors.length)
    context.addIssue({ code: 'custom', message: 'Duplicate actor model binding' })
})
export type ModelBindingSnapshot = z.infer<typeof modelBindingSnapshotSchema>

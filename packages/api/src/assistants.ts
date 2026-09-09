import { z } from 'zod'
import { actorIdSchema } from './director.ts'

export const assistantTargetSchema = z.object({
  assistantId: actorIdSchema.optional(), assistantName: z.string().trim().min(1).max(200).optional(),
}).strict().refine(value => value.assistantId !== undefined || Boolean(value.assistantName), 'Provide assistantId or assistantName')
export type AssistantTarget = z.infer<typeof assistantTargetSchema>

import { z } from 'zod'

export const promptModeSchema = z.object({ enabled: z.boolean() }).strict()
export type PromptMode = z.infer<typeof promptModeSchema>
export const promptModeConfigSchema = promptModeSchema.safeExtend({ updatedAt: z.number().int().nonnegative() })
export type PromptModeConfig = z.infer<typeof promptModeConfigSchema>
export const promptModeUpdateSchema = promptModeSchema.safeExtend({ expectedUpdatedAt: z.number().int().nonnegative() })
export const promptModeRpcMethods = {
  'prompt.mode.get': { params: z.object({}).strict(), result: promptModeConfigSchema },
  'prompt.mode.update': { params: promptModeUpdateSchema, result: promptModeConfigSchema },
} as const

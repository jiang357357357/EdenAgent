import { z } from 'zod'
export const commandExecutionConfigSchema = z.object({
  mode: z.enum(['sandbox', 'host']), networkAccess: z.boolean(), writableRoots: z.array(z.string().min(1).max(4096)).max(16),
}).strict()
export const commandExecutionSetSchema = commandExecutionConfigSchema.extend({ confirmHostExecution: z.boolean() })
export const commandExecutionInfoSchema = commandExecutionConfigSchema.extend({
  available: z.boolean(), hostAvailable: z.boolean(), hostShell: z.string(), sandboxAvailable: z.boolean(), sandboxBackend: z.string(), shell: z.string(), detail: z.string(),
})
export type CommandExecutionConfig = z.infer<typeof commandExecutionConfigSchema>
export type CommandExecutionInfo = z.infer<typeof commandExecutionInfoSchema>

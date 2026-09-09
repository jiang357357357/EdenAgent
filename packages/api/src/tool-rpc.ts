import { z } from 'zod'
import { jsonValue } from './json.ts'
export const toolInfoSchema = z.object({
  name: z.string(), label: z.string(), description: z.string(), parameters: jsonValue,
  source: z.string(), version: z.string(), namespace: z.string(),
  executionMode: z.enum(['parallel', 'sequential']), exposure: z.enum(['direct', 'deferred', 'hidden']),
})
export type ToolInfo = z.infer<typeof toolInfoSchema>
export const toolRpcMethods = { 'tool.list': { params: z.object({}).strict(), result: z.array(toolInfoSchema) } } as const

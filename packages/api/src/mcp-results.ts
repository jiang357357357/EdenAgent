import { z } from 'zod'
export const mcpResultReadSchema = z.object({ sessionId: z.string().uuid(), operationId: z.string().min(1).max(1024) }).strict()
export const mcpResultExportSchema = mcpResultReadSchema.extend({ index: z.number().int().min(0).max(1024) })
export const mcpResultViewSchema = z.object({ state: z.string(), parts: z.array(z.object({ index: z.number(), kind: z.string(), mimeType: z.string().nullable(),
  text: z.string().nullable(), truncated: z.boolean(), binary: z.boolean() })) })
export type McpResultView = z.infer<typeof mcpResultViewSchema>

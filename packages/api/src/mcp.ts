import { z } from 'zod'
export const mcpOperationListSchema = z.object({ sessionId: z.string().uuid(), before: z.number().int().positive().safe().optional() }).strict()
export const mcpStatusSchema = z.object({ runtimes: z.array(z.object({ id: z.string(), pluginId: z.string(), componentId: z.string(),
  revision: z.string(), kind: z.enum(['mcp_stdio', 'mcp_http']), server: z.object({ name: z.string(), version: z.string() }) })),
  errors: z.array(z.object({ id: z.string(), error: z.string() })) })
export const mcpOperationHistorySchema = z.object({ items: z.array(z.object({ id: z.string(), runtimeId: z.string(), revision: z.string(),
  method: z.string(), name: z.string(), state: z.enum(['running', 'completed', 'failed', 'unknown']), error: z.string().nullable(),
  createdAt: z.number(), updatedAt: z.number() })), nextCursor: z.number().nullable() })
export type McpStatus = z.infer<typeof mcpStatusSchema>
export type McpOperationHistory = z.infer<typeof mcpOperationHistorySchema>

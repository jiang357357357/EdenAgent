import { z } from 'zod'
import { initializeSchema, protocolVersion } from './rpc.ts'
import { runtimeOriginSchema } from './runtime.ts'
import { sessionEventSchema } from './session-rpc.ts'
export const initializeResultSchema = z.object({
  protocolVersion: z.literal(protocolVersion), serverName: z.string(), serverVersion: z.string(),
  agentCoreVersion: z.string(), runtimeOrigin: runtimeOriginSchema, capabilities: z.array(z.string()),
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
})
export type InitializeResult = z.infer<typeof initializeResultSchema>
export const connectionRpcMethods = { initialize: { params: initializeSchema, result: initializeResultSchema } } as const
export const rpcNotifications = {
  'desktop.reminder.changed': z.object({ runtimeOrigin: runtimeOriginSchema }).strict(),
  'session.event': sessionEventSchema,
  'session.discovered': z.object({ sessionId: z.string().uuid(), afterSeq: z.string().regex(/^\d+$/) }).strict(),
  'server.warning': z.object({ code: z.string(), skipped: z.number().int().nonnegative().optional(), recovery: z.string().optional() }),
} as const
export type SchemaRpcNotificationMap = { [K in keyof typeof rpcNotifications]: z.output<(typeof rpcNotifications)[K]> }

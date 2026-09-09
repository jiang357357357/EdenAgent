import { z } from 'zod'
import { initializeSchema, protocolVersion } from './rpc.ts'
import { runtimeOriginSchema } from './runtime.ts'
import { sessionEventSchema } from './session-rpc.ts'
export const initializeResultSchema = z.object({
  protocolVersion: z.literal(protocolVersion), serverName: z.string(), serverVersion: z.string(),
  agentCoreVersion: z.string(), runtimeOrigin: runtimeOriginSchema, capabilities: z.array(z.string()),
})
export type InitializeResult = z.infer<typeof initializeResultSchema>
export const connectionRpcMethods = { initialize: { params: initializeSchema, result: initializeResultSchema } } as const
export const rpcNotifications = {
  'session.event': sessionEventSchema,
  'server.warning': z.object({ code: z.string(), skipped: z.number().int().nonnegative().optional(), recovery: z.string().optional() }),
} as const
export type SchemaRpcNotificationMap = { [K in keyof typeof rpcNotifications]: z.output<(typeof rpcNotifications)[K]> }

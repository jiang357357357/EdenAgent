import { uiPreferenceRpcMethods } from './ui-preferences.ts'
import { connectionRpcMethods } from './connection-rpc.ts'
import { migrationRpcMethods } from './migration-rpc.ts'
import { operationRpcMethods } from './operations.ts'
import { toolRpcMethods } from './tool-rpc.ts'
import { reasoningRpcMethods } from './reasoning-rpc.ts'
import { subagentRpcMethods } from './subagent-rpc.ts'
import { selfAwakeRpcMethods } from './self-awake-rpc.ts'
import { skillRpcMethods } from './skill-rpc.ts'
import { pluginMarketRpcMethods } from './plugin-market-rpc.ts'
import { pluginManagementRpcMethods } from './plugin-management.ts'
import { pluginDevelopmentRpcMethods } from './plugin-development.ts'
import { z } from 'zod'
import { connectorRpcMethods } from './connector-rpc.ts'
import { memoRpcMethods } from './memo-rpc.ts'
import { mediaRpcMethods } from './media-rpc.ts'
import { voiceRpcMethods } from './voice-rpc.ts'
import { modelRpcMethods } from './model-rpc.ts'
import { interactionRpcMethods } from './interaction-rpc.ts'
import { turnRpcMethods } from './turn-rpc.ts'
import { sessionRpcMethods } from './session-rpc.ts'
import { blobInfoSchema } from './blobs.ts'
import { mcpOperationListSchema, mcpOperationHistorySchema, mcpStatusSchema } from './mcp.ts'
import { mcpResultReadSchema, mcpResultViewSchema, mcpResultExportSchema } from './mcp-results.ts'

/** Migrated methods share runtime validation and inferred browser types. Add remaining domains here. */
export const rpcMethods = {
  ...uiPreferenceRpcMethods,
  ...migrationRpcMethods,
  ...connectionRpcMethods,
  ...operationRpcMethods,
  ...toolRpcMethods,
  ...reasoningRpcMethods,
  ...subagentRpcMethods,
  ...selfAwakeRpcMethods,
  ...skillRpcMethods,
  ...pluginMarketRpcMethods,
  ...pluginManagementRpcMethods,
  ...pluginDevelopmentRpcMethods,
  ...connectorRpcMethods,
  ...memoRpcMethods,
  ...mediaRpcMethods,
  ...voiceRpcMethods,
  ...modelRpcMethods,
  ...turnRpcMethods,
  ...interactionRpcMethods,
  ...sessionRpcMethods,
  'mcp.status': { params: z.object({}).strict(), result: mcpStatusSchema },
  'mcp.operations': { params: mcpOperationListSchema, result: mcpOperationHistorySchema },
  'mcp.result.read': { params: mcpResultReadSchema, result: mcpResultViewSchema },
  'mcp.result.export': { params: mcpResultExportSchema, result: blobInfoSchema },
} as const
export type SchemaRpcMethodMap = {
  [K in keyof typeof rpcMethods]: { params: z.input<(typeof rpcMethods)[K]['params']>; result: z.output<(typeof rpcMethods)[K]['result']> }
}

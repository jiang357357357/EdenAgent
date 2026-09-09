import { toJson, rpcMethods, type JsonValue } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import type { EdenDatabase } from '@eden/store'
import { mcpOperationHistory, type McpLifecycle, type McpResults } from '../../modules/mcp/index.ts'
export function mcpRoutes(lifecycle: McpLifecycle, database: EdenDatabase, results: McpResults): Record<string, (raw: JsonValue) => JsonValue | Promise<JsonValue>> {
  return {
    'mcp.result.read': contractHandler(rpcMethods['mcp.result.read'], input => results.read(input)),
    'mcp.result.export': contractHandler(rpcMethods['mcp.result.export'], input => results.export(input)),
    'mcp.status': contractHandler(rpcMethods['mcp.status'], () => lifecycle.list()),
    'mcp.operations': contractHandler(rpcMethods['mcp.operations'], input => mcpOperationHistory(database, toJson(input))),
  }
}

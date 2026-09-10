import { z } from 'zod'
import { jsonValue, toJson, type JsonValue } from '@eden/api'
import { McpRemoteError } from '@eden/integrations'
import type { RuntimeTool } from '@eden/runtime-pi'
import type { EdenDatabase } from '@eden/store'
import type { PermissionService } from '../permissions/index.ts'
import type { McpLifecycle } from './lifecycle.ts'
import { dynamicMcpTools } from './dynamic-tools.ts'
import { mcpResultImages } from './result-images.ts'
const input = z.object({ runtimeId: z.string().min(1).max(300), name: z.string().min(1).max(8192).optional(), arguments: z.record(z.string(), jsonValue).default({}) }).strict()
export function mcpTools(lifecycle: McpLifecycle, database: EdenDatabase, permissions: PermissionService, sessionId: string, turnId: string): RuntimeTool[] {
  const tools: RuntimeTool[] = [{
    name: 'list_mcp_servers', revision: 'eden.mcp.v1', description: 'List active MCP plugin runtimes and initialization errors.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute(raw) { z.object({}).strict().parse(raw); return toJson(lifecycle.list()) }
  },
  ...(['catalog', 'call', 'read'] as const).map(kind => ({
    name: kind === 'catalog' ? 'list_mcp_capabilities' : kind === 'call' ? 'call_mcp_tool' : 'read_mcp_resource',
    revision: 'eden.mcp.v1', executionMode: 'sequential' as const,
    resultImages: mcpResultImages,
    description: kind === 'catalog' ? 'Discover remote tools, resources and resource templates after approval.' : 'Invoke an MCP tool or read a resource after approval. Unknown operations must not be automatically repeated. name is the tool name or resource URI.',
    parameters: toJson(z.toJSONSchema(input, { io: 'input' })) as Record<string, JsonValue>,
    async execute(raw: Record<string, unknown>, context: { callId: string; signal: AbortSignal }) {
      const value = input.parse(raw), runtime = lifecycle.get(value.runtimeId), revision = runtime.component.revision
      if (kind !== 'catalog' && !value.name) throw new Error('MCP tool name or resource URI is required')
      const definition = kind === 'call' ? lifecycle.catalog.list().find(item => item.runtimeId === value.runtimeId && item.remote.name === value.name) : undefined
      if (kind === 'call' && !definition) throw new Error('MCP tool is not in the current remote catalog')
      if (JSON.stringify(value.arguments).length > 65536) throw new Error('MCP arguments exceed limit')
      await permissions.request({ ...context, sessionId, turnId }, `mcp.${kind}`, `${value.runtimeId}:${value.name ?? '*'}`, toJson({ revision, arguments: value.arguments }))
      context.signal.throwIfAborted()
      const current = lifecycle.get(value.runtimeId, revision)
      if (current !== runtime) throw new Error('MCP runtime restarted during approval')
      if (definition && !lifecycle.catalog.matches(definition)) throw new Error('MCP tool changed during approval')
      if (kind === 'catalog') return toJson({ tools: await current.client.tools(context.signal), resources: await current.client.resources(context.signal), templates: await current.client.templates(context.signal) })
      return executeMcpOperation(database, turnId, sessionId, context, value, revision, kind, current)

    }
  }))]
  return [...tools, ...dynamicMcpTools(lifecycle, tools.find(tool => tool.name === 'call_mcp_tool')!)]
}

async function executeMcpOperation(database: EdenDatabase, turnId: string, sessionId: string, context: { callId: string; signal: AbortSignal }, value: z.output<typeof input>, revision: string, kind: 'call' | 'read', current: ReturnType<McpLifecycle['get']>) {
  const id = `${turnId}:${context.callId}`, db = database.connection
  if (db.prepare('SELECT 1 FROM mcp_operations WHERE id=?').get(id)) throw new Error('MCP operation already exists; inspect its outcome before retrying')
  db.prepare("INSERT INTO mcp_operations VALUES(?,?,?,?,?,?,?,'running',NULL,NULL,?,?)")
    .run(id, sessionId, value.runtimeId, revision, kind, value.name!, JSON.stringify(value.arguments), Date.now(), Date.now())
  try {
    const result = kind === 'call' ? await current.client.call(value.name!, value.arguments, context.signal) : await current.client.read(value.name!, context.signal)
    const failed = result && typeof result === 'object' && !Array.isArray(result) && result.isError === true
    db.prepare('UPDATE mcp_operations SET state=?,result_json=?,updated_at=? WHERE id=?').run(failed ? 'failed' : 'completed', JSON.stringify(result), Date.now(), id)
    return result
  } catch (error) {
    db.prepare('UPDATE mcp_operations SET state=?,error=?,updated_at=? WHERE id=?').run(error instanceof McpRemoteError ? 'failed' : 'unknown',
      error instanceof McpRemoteError ? 'MCP server rejected request' : 'MCP operation outcome was not confirmed', Date.now(), id)
    throw error
  }
}

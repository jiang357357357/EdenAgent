import { z } from 'zod'
import { jsonValue, toJson } from '@eden/api'
import type { RuntimeTool } from '@eden/runtime-pi'
import type { JsonValue } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { PermissionService } from '../permissions/index.ts'
import type { ConnectorRepository } from './repository.ts'
import type { ConnectorCatalog } from './catalog.ts'
import type { ConnectorLifecycle } from './lifecycle.ts'
import { capabilityInput } from './capability-input.ts'
import { WorkerRemoteError } from './worker-channel.ts'
const inputSchema = z.object({ connectorId: z.string().uuid(), capability: z.string().min(1).max(128), payload: jsonValue.default({}) }).strict()
export function connectorCapabilityTools(database: EdenDatabase, connectors: ConnectorRepository, catalog: ConnectorCatalog,
  lifecycle: ConnectorLifecycle, permissions: PermissionService, sessionId: string, turnId: string): RuntimeTool[] {
  return (['query', 'execute'] as const).map(method => ({
    name: method === 'query' ? 'query_connector' : 'execute_connector', revision: 'eden.connectors.capabilities.v1', executionMode: 'sequential',
    description: `${method === 'query' ? 'Query' : 'Execute'} a declared capability on a connector bound to this session, after approval. Failed or unknown actions must not be automatically repeated.`,
    parameters: toJson(z.toJSONSchema(inputSchema, { io: 'input' })) as Record<string, JsonValue>,
    async execute(raw, context) {
      const input = inputSchema.parse(raw), current = connectors.read(input.connectorId)
      if (current.settings.boundSessionId !== sessionId) throw new Error('Connector is not bound to this session')
      const descriptor = catalog.descriptor(current.connectorKey)
      const schema = descriptor.manifest[method === 'query' ? 'queries' : 'actions'][input.capability]
      if (!schema) throw new Error('Connector capability is not declared')
      const payload = toJson(capabilityInput(schema).parse(input.payload))
      if (JSON.stringify(payload).length > 65536) throw new Error('Connector capability input exceeds limit')
      await permissions.request({ ...context, sessionId, turnId }, `connector.${method}`, `${current.id}:${input.capability}`,
        { generation: current.generation, revision: descriptor.revision, payload })
      context.signal.throwIfAborted()
      const updated = connectors.read(current.id)
      if (updated.generation !== current.generation || updated.settings.boundSessionId !== sessionId) throw new Error('Connector changed during approval')
      const operationId = `${turnId}:${context.callId}`, db = database.connection
      if (db.prepare('SELECT 1 FROM connector_operations WHERE id=?').get(operationId)) throw new Error('Connector operation already exists; inspect its outcome before retrying')
      db.prepare("INSERT INTO connector_operations VALUES(?,?,?,?,?,?,'running',NULL,NULL,?,?)")
        .run(operationId, current.id, sessionId, current.generation, method, JSON.stringify({ capability: input.capability, payload }), Date.now(), Date.now())
      try {
        const result = await lifecycle.invoke(current.id, current.generation, method, input.capability, payload, operationId, context.signal)
        db.prepare("UPDATE connector_operations SET state='completed',result_json=?,updated_at=? WHERE id=?").run(JSON.stringify(result), Date.now(), operationId)
        return result
      } catch (error) {
        db.prepare('UPDATE connector_operations SET state=?,error=?,updated_at=? WHERE id=?').run(error instanceof WorkerRemoteError ? 'failed' : 'unknown',
          error instanceof WorkerRemoteError ? 'Worker rejected this capability call' : 'Connector call outcome was not confirmed', Date.now(), operationId)
        throw error
      }
    },
  }))
}

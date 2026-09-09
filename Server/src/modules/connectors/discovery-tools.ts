import { z } from 'zod'
import { toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { RuntimeTool } from '@eden/runtime-pi'
import type { ConnectorCatalog } from './catalog.ts'
import type { ConnectorRepository } from './repository.ts'
const schema = z.object({ connectorId: z.string().uuid().optional() }).strict()
export function connectorDiscoveryTools(repository: ConnectorRepository, catalog: ConnectorCatalog, sessionId: string): RuntimeTool[] {
  return [{ name: 'list_connectors', revision: 'eden.connectors.discovery.v1', executionMode: 'sequential',
    description: 'List connector identities bound to this session. Provide connectorId to inspect declared query/action parameter schemas. Declared capabilities may be unavailable until its worker is connected and approved.',
    parameters: toJson(z.toJSONSchema(schema)) as Record<string, JsonValue>,
    async execute(raw, context) {
      context.signal.throwIfAborted()
      const input = schema.parse(raw)
      const bound = repository.list().filter(item => item.settings.boundSessionId === sessionId)
      const summarize = (item: typeof bound[number]) => ({ id: item.id, key: item.connectorKey, name: item.displayName,
        desiredState: item.desiredState, runtimeState: item.runtimeState, lastError: item.lastError })
      if (!input.connectorId) return toJson({ connectors: bound.map(summarize) })
      const item = bound.find(value => value.id === input.connectorId)
      if (!item) throw new Error('Connector is not bound to this session')
      const descriptor = catalog.descriptor(item.connectorKey)
      return toJson({ ...summarize(item), revision: descriptor.revision, queries: descriptor.manifest.queries, actions: descriptor.manifest.actions,
        events: Object.keys(descriptor.manifest.events), queryTool: 'query_connector', actionTool: 'execute_connector' })
    },
  }]
}

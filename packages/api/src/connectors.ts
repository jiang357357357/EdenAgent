import { z } from 'zod'
import { jsonValue } from './json.ts'
const fields = { displayName: z.string().trim().min(1).max(256), desiredState: z.enum(['connected', 'disconnected']), settings: jsonValue }
export const connectorCreateSchema = z.object({ connectorKey: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/), identityKey: z.string().trim().min(1).max(256), ...fields }).strict()
export const connectorUpdateSchema = z.object({ id: z.string().uuid(), patch: z.object(fields).partial().strict() }).strict()

export const connectorInfoSchema = z.object({ id: z.string().uuid(), generation: z.string(), connectorKey: z.string(), identityKey: z.string(), displayName: z.string(),
  desiredState: z.enum(['connected', 'disconnected']), runtimeState: z.string(), settings: jsonValue, lastError: z.string().nullable(), createdAt: z.number(), updatedAt: z.number() })
export const connectorCapabilitySchema = z.object({ id: z.string(), kind: z.string(), direction: z.string(), label: z.string(), description: z.string(), schema: jsonValue,
  invocation: z.object({ tool: z.string(), action: z.string().nullable().optional(), query: z.string().nullable().optional() }).nullable() })
export const connectorCatalogEntrySchema = z.object({ key: z.string(), name: z.string(), description: z.string(), icon: z.string(), version: z.string(), revision: z.string(),
  hot_reload: z.boolean(), worker_isolated: z.boolean(), settings_schema: jsonValue, capabilities: z.array(connectorCapabilitySchema) })
export const connectorCatalogSchema = z.object({ connectors: z.array(connectorCatalogEntrySchema), errors: z.array(z.object({ key: z.string(), error: z.string() })) })
export type ConnectorInfo = z.infer<typeof connectorInfoSchema>
export type ConnectorCapabilityInfo = z.infer<typeof connectorCapabilitySchema>
export type ConnectorCatalogEntry = z.infer<typeof connectorCatalogEntrySchema>

import { z } from 'zod'
import { jsonValue } from './json.ts'
const property = z.object({ type: z.enum(['string', 'integer', 'boolean']), minLength: z.number().optional(), maxLength: z.number().optional(),
  minimum: z.number().optional(), maximum: z.number().optional(), pattern: z.string().optional(), format: z.literal('uuid').optional() })
const settingReference = z.string().regex(/^settings\.[a-zA-Z][a-zA-Z0-9_]*$/)
const networkBinding = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('http'), resource: z.string().min(1), setting: settingReference, fallback: z.string().url() }).strict(),
  z.object({ kind: z.literal('tcp'), resource: z.string().min(1), host: settingReference, port: settingReference,
    registry: z.object({ setting: settingReference, hostField: z.string().min(1), portField: z.string().min(1), processIdentity: z.boolean().default(false), settingsFields: z.record(z.string(), z.string()).default({}) }).strict().optional() }).strict()
])
export const connectorManifestSchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/), name: z.string(), description: z.string(), icon: z.string(), version: z.string(),
  runtime: z.enum(['native', 'node']).default('native'),
  network: networkBinding.optional(),
  entrypoints: z.record(z.string(), z.object({ path: z.string().min(1).max(4096), args: z.array(z.string().max(4096)).max(32) })),
  permissions: z.array(z.object({ capability: z.string().min(1).max(128), resource: z.string().min(1).max(4096), access: z.string().min(1).max(64), required: z.boolean(), description: z.string().max(4000) })).max(128),
  settingsSchema: z.object({ type: z.literal('object'), properties: z.record(z.string(), property), additionalProperties: z.literal(false) }),
  events: z.record(z.string(), jsonValue), queries: z.record(z.string(), jsonValue), actions: z.record(z.string(), jsonValue) })
export type ConnectorManifest = z.infer<typeof connectorManifestSchema>

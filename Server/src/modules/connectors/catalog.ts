import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { jsonValue, toJson } from '@eden/api'
import path from 'node:path'
import { officialConnectorPackage } from './package-location.ts'
const property = z.object({ type: z.enum(['string', 'integer', 'boolean']), minLength: z.number().optional(), maxLength: z.number().optional(),
  minimum: z.number().optional(), maximum: z.number().optional(), pattern: z.string().optional(), format: z.literal('uuid').optional() })
const manifestSchema = z.object({ id: z.string(), name: z.string(), description: z.string(), icon: z.string(), version: z.string(),
  entrypoints: z.record(z.string(), z.object({ path: z.string().min(1).max(4096), args: z.array(z.string().max(4096)).max(32) })),
  permissions: z.array(z.object({ capability: z.string().min(1).max(128), resource: z.string().min(1).max(4096), access: z.string().min(1).max(64), required: z.boolean(), description: z.string().max(4000) })).max(128),
  settingsSchema: z.object({ type: z.literal('object'), properties: z.record(z.string(), property), additionalProperties: z.literal(false) }),
  events: z.record(z.string(), jsonValue), queries: z.record(z.string(), jsonValue), actions: z.record(z.string(), jsonValue) })
export class ConnectorCatalog {
  private readonly entries = new Map<string, { manifest: z.infer<typeof manifestSchema>; revision: string; packageRoot: string }>()
  private readonly errors: { key: string; error: string }[] = []
  constructor() {
    for (const key of ['lichess', 'openttd', 'victoria3', 'hoi4']) {
      try {
        const packageRoot = officialConnectorPackage(key)
        const bytes = readFileSync(path.join(packageRoot, 'connector.json'))
        const manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')))
        if (manifest.id !== key) throw new Error('Connector manifest identity mismatch')
        this.entries.set(key, { manifest, revision: createHash('sha256').update(bytes).digest('hex'), packageRoot })
      } catch { this.errors.push({ key, error: 'Official connector manifest is unavailable or invalid' }) }
    }
  }
  list() {
    return { connectors: [...this.entries.values()].map(({ manifest: item, revision }) => ({ key: item.id, name: item.name,
      description: item.description, icon: item.icon, version: item.version, revision, hot_reload: false, worker_isolated: true,
      settings_schema: toJson(item.settingsSchema), capabilities: (['events', 'queries', 'actions'] as const).flatMap(kind =>
        Object.entries(item[kind]).map(([id, schema]) => ({ id, kind: kind === 'events' ? 'event' : kind === 'queries' ? 'query' : 'action',
          direction: kind === 'events' ? 'inbound' : 'outbound', label: schema && typeof schema === 'object' && !Array.isArray(schema) && typeof schema.title === 'string' ? schema.title : id,
          description: '', schema, invocation: null }))) })), errors: this.errors }
  }
  descriptor(key: string) {
    const entry = this.entries.get(key)
    if (!entry) throw new Error('Official connector manifest is unavailable')
    return { manifest: manifestSchema.parse(entry.manifest), revision: entry.revision, packageRoot: entry.packageRoot }
  }
  assertEvent(key: string, eventType: string) {
    const entry = this.entries.get(key)
    if (!entry || !Object.hasOwn(entry.manifest.events, eventType)) throw new Error('Connector event is not declared in its manifest')
  }
  validate(key: string, raw: unknown) {
    const entry = this.entries.get(key)
    if (!entry) throw new Error('Connector is not present in the official catalog')
    const shape: Record<string, z.ZodType> = {}
    for (const [name, field] of Object.entries(entry.manifest.settingsSchema.properties)) {
      if (field.type === 'boolean') shape[name] = z.boolean().optional()
      else if (field.type === 'integer') shape[name] = z.number().int().min(field.minimum ?? Number.MIN_SAFE_INTEGER).max(field.maximum ?? Number.MAX_SAFE_INTEGER).optional()
      else {
        let schema = z.string().min(field.minLength ?? 0).max(field.maxLength ?? 4096)
        if (field.pattern) schema = schema.regex(new RegExp(field.pattern))
        if (field.format === 'uuid') schema = schema.uuid()
        shape[name] = schema.optional()
      }
    }
    return toJson(z.object(shape).strict().parse(raw))
  }
}

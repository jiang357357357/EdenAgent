import type { InstalledPackageRepository } from '../plugin-market/index.ts'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { connectorManifestSchema as manifestSchema, toJson } from '@eden/api'
import path from 'node:path'
import { officialConnectorPackage } from './package-location.ts'
export class ConnectorCatalog {
  private readonly entries = new Map<string, { manifest: z.infer<typeof manifestSchema>; revision: string; packageRoot: string }>()
  private nativeProvider?: () => ReturnType<InstalledPackageRepository['nativeSelectionPlans']>
  attachNativeProvider(provider: () => ReturnType<InstalledPackageRepository['nativeSelectionPlans']>) { this.nativeProvider = provider }
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
    const native = this.nativeProvider?.() ?? []
    const entries = [...this.entries.entries()].map(([key, entry]) => ({ key, ...entry }))
    entries.push(...native.flatMap(item => item.plans.map(plan => ({ key: plan.key, manifest: plan.manifest, revision: plan.revision, packageRoot: '' }))))
    return { connectors: entries.map(({ key, manifest: item, revision }) => ({ key, name: item.name,
      description: item.description, icon: item.icon, version: item.version, revision, hot_reload: false, worker_isolated: true,
      settings_schema: toJson(item.settingsSchema), capabilities: (['events', 'queries', 'actions'] as const).flatMap(kind =>
        Object.entries(item[kind]).map(([id, schema]) => ({ id, kind: kind === 'events' ? 'event' : kind === 'queries' ? 'query' : 'action',
          direction: kind === 'events' ? 'inbound' : 'outbound', label: schema && typeof schema === 'object' && !Array.isArray(schema) && typeof schema.title === 'string' ? schema.title : id,
          description: '', schema, invocation: null }))) })), errors: [...this.errors, ...native.filter(item => item.error).map(item => ({ key: item.id, error: item.error! }))] }
  }
  descriptor(key: string) {
    const entry = this.entries.get(key)
    if (entry) return { manifest: manifestSchema.parse(entry.manifest), revision: entry.revision, packageRoot: entry.packageRoot, native: undefined }
    const native = this.nativeProvider?.().flatMap(item => item.plans).find(plan => plan.key === key)
    if (!native) throw new Error('Connector component is unavailable or its plugin authorization changed')
    return { manifest: native.manifest, revision: native.revision, packageRoot: '', native }
  }
  assertEvent(key: string, eventType: string) {
    const entry = this.descriptor(key)
    if (!Object.hasOwn(entry.manifest.events, eventType)) throw new Error('Connector event is not declared in its manifest')
  }
  validate(key: string, raw: unknown) {
    const entry = this.descriptor(key)
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

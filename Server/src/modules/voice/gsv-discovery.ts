import { gsvDiscoverySchema } from '@eden/api'
import { z } from 'zod'
import { gsvResponse } from './gsv-client.ts'
interface Option { id: string; label: string; value: string }
function options(raw: unknown, key: string): Option[] {
  const payload = z.record(z.string(), z.unknown()).parse(raw)
  const items = z.array(z.unknown()).max(10000).parse(payload[key] ?? [])
  return items.flatMap(item => {
    if (typeof item === 'string') return item.trim() ? [{ id: '', label: item.trim(), value: item.trim() }] : []
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    const name = row.name ?? row.value ?? row.label
    if (typeof name !== 'string' || !name.trim()) return []
    const label = row.label ?? row.name
    return [{
      id: typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : '',
      label: typeof label === 'string' ? label : name.trim(), value: name.trim()
    }]
  })
}
export async function discoverGsv(raw: unknown, signal: AbortSignal) {
  const { config, stage } = gsvDiscoverySchema.parse(raw)
  const started = Date.now()
  const request = async (path: string, key: string, query: Record<string, string> = {}) => {
    const response = await gsvResponse({ ...config, timeoutSeconds: Math.min(12, config.timeoutSeconds) },
      path + '?' + new URLSearchParams(query), signal)
    return options(JSON.parse(response.bytes.toString('utf8')), key)
  }
  let versions: Option[] = [], worlds: Option[] = [], roles: Option[] = [], emotions: Option[] = []
  let version = config.version, world = config.world
  let selected: Option | undefined = config.roleId ? { id: config.roleId, value: config.role, label: config.role } : undefined
    ; ({ versions, version, worlds, world } = await discoverCatalog(stage, versions, request, version, worlds, world))
  if ((stage === 'all' || stage === 'roles' || (stage === 'emotions' && !selected)) && version && world) {
    roles = await request('/api/role/list/', 'roles', { version, world_name: world })
    selected = roles.find(option => option.id === config.roleId) ?? roles.find(option => option.value === config.role) ?? roles[0]
  }
  if ((stage === 'all' || stage === 'emotions') && selected?.id) {
    emotions = await request('/api/role/emotions/', 'emotions', { role_id: selected.id })
  }
  return { ok: true, latencyMs: Date.now() - started, versions, worlds, roles, emotions, selectedRoleId: selected?.id ?? '' }
}

async function discoverCatalog(stage: string, versions: Option[], request: (path: string, key: string, query?: Record<string, string>) => Promise<Option[]>, version: string, worlds: Option[], world: string) {
  if (stage === 'all' || stage === 'catalog') {
    versions = await request('/api/models/versions/from-enum/', 'versions')
    if (!versions.some(option => option.value === version)) version = versions[0]?.value ?? version
  }
  if (['all', 'catalog', 'worlds'].includes(stage) && version) {
    worlds = await request('/api/world/list/', 'worlds', { version })
    if (!worlds.some(option => option.value === world)) world = worlds[0]?.value ?? world
  }
  return { versions, version, worlds, world }
}

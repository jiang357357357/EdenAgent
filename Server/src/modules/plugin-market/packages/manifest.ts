import { packageAssetFiles } from './asset-files.ts'
import { nativeWorkerDescriptor } from './native-descriptor.ts'
import { z } from 'zod'
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/)
const relative = z.string().min(1).max(1024).refine(value => !value.startsWith('/') && !/[\\:\x00-\x1f]/.test(value) && value.split('/').every(part => part !== '..' && part !== '.' && part !== ''), 'Package path must be relative')
const skill = z.object({ id, path: relative, enabledByDefault: z.boolean().default(true) }).strict()
const runtime = z.object({ id, kind: z.enum(['native_worker', 'mcp_stdio', 'mcp_http']), manifest: relative, enabledByDefault: z.boolean().default(true) }).strict()
const ui = z.object({ id, entry: relative, enabledByDefault: z.boolean().default(false) }).strict()
const hook = z.object({ id, event: z.string().min(1).max(128), skill: id, enabledByDefault: z.boolean().default(false) }).strict()
export const packageManifestSchema = z.object({
  schemaVersion: z.literal(1), id, name: z.string().min(1).max(256), description: z.string().max(4000), version: z.string().min(1).max(64),
  minHostVersion: z.string().max(64).optional(), maxHostVersion: z.string().max(64).optional(),
  components: z.object({ skills: z.array(skill).max(128).default([]), runtimes: z.array(runtime).max(128).default([]), ui: z.array(ui).max(128).default([]), hooks: z.array(hook).max(128).default([]) }).strict().default({ skills: [], runtimes: [], ui: [], hooks: [] }),
  permissions: z.array(z.object({ capability: z.string().min(1).max(128), resource: z.string().max(4096), access: z.string().max(128), required: z.boolean().default(false), description: z.string().max(4000) }).strict()).max(256).default([]),
  assets: z.array(z.object({ source: relative, targetKind: z.string().min(1).max(128), target: relative }).strict()).max(512).default([]),
}).strict()
export function packageManifest(raw: unknown, files: Map<string, Buffer>) {
  const manifest = packageManifestSchema.parse(raw), ids = new Set<string>()
  for (const item of Object.values(manifest.components).flat()) {
    if (ids.has(item.id)) throw new Error('Duplicate component ID in plugin package')
    ids.add(item.id)
  }
  assertUniquePermissions(manifest)
  for (const item of manifest.components.skills) if (!files.has(`${item.path}/SKILL.md`)) throw new Error('Skill component has no SKILL.md')
  for (const item of manifest.components.runtimes) if (!files.has(item.manifest)) throw new Error('Runtime component manifest is missing')
  for (const item of manifest.components.runtimes) if (item.kind === 'native_worker') {
    const native = nativeWorkerDescriptor(files, item.manifest)
    for (const permission of native.manifest.permissions) if (!manifest.permissions.some(declared => declared.capability === permission.capability && declared.resource === permission.resource && declared.access === permission.access && (!permission.required || declared.required))) throw new Error('Native worker permission is absent from its owning plugin manifest')
  }
  for (const item of manifest.components.ui) if (!files.has(item.entry)) throw new Error('UI component entry is missing')
  for (const item of manifest.components.hooks) if (!manifest.components.skills.some(skill => skill.id === item.skill)) throw new Error('Hook refers to an absent skill component')
  packageAssetFiles(manifest.assets, files)
  return manifest
}
function assertUniquePermissions(manifest: z.infer<typeof packageManifestSchema>) {
  const permissionKeys = new Set<string>()
  for (const permission of manifest.permissions) {
    const key = JSON.stringify([permission.capability, permission.resource, permission.access])
    if (permissionKeys.has(key)) throw new Error('Duplicate plugin permission declaration')
    permissionKeys.add(key)
  }
}

export function componentSummary(manifest: z.infer<typeof packageManifestSchema>) {
  return [...manifest.components.skills.map(item => ({ id: item.id, kind: 'skill', path: item.path, enabledByDefault: item.enabledByDefault })),
  ...manifest.components.runtimes.map(item => ({ id: item.id, kind: item.kind, path: item.manifest, enabledByDefault: item.enabledByDefault })),
  ...manifest.components.ui.map(item => ({ id: item.id, kind: 'ui', path: item.entry, enabledByDefault: item.enabledByDefault })),
  ...manifest.components.hooks.map(item => ({ id: item.id, kind: 'hook', path: item.skill, enabledByDefault: item.enabledByDefault }))]
}

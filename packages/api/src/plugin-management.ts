import { z } from 'zod'
import { jsonValue } from './json.ts'
import { pluginIdSchema } from './plugins.ts'
import { packagePermissionSetSchema } from './plugin-package-permissions.ts'
export const managedPluginIdSchema = z.object({ id: z.union([pluginIdSchema.shape.id, z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/)]) }).strict()
const revision = z.string().regex(/^[a-f0-9]{64}$/)
export const managedPluginInfoSchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), version: z.string(), revision,
  enabled: z.boolean(), trustState: z.string(), sourceType: z.string(), sourceUri: z.string(),
  components: z.array(z.object({ id: z.string(), kind: z.string(), path: z.string(), enabledByDefault: z.boolean(), enabled: z.boolean().optional() })),
  uiContributions: z.array(z.object({ id: z.string(), componentId: z.string(), location: z.enum(['plugin_detail', 'settings']),
    title: z.string(), body: z.string(), tone: z.enum(['info', 'success', 'warning']) })),
  permissions: z.array(z.object({ capability: z.string(), resource: z.string(), access: z.string(), required: z.boolean(), description: z.string() })),
  permissionGrants: z.array(z.object({ capability: z.string(), resource: z.string(), access: z.string(),
    decision: z.enum(['allowed', 'denied']), revision, updatedAt: z.number().int() })),
  versions: z.array(z.object({ version: z.string(), revision, active: z.boolean(), trustState: z.string(),
    sourceType: z.string(), sourceUri: z.string(), installedAt: z.number().int() })),
  manifest: jsonValue, createdAt: z.number().int(), updatedAt: z.number().int(),
})
export type ManagedPluginInfo = z.infer<typeof managedPluginInfoSchema>
export const pluginManagementRpcMethods = {
  'plugin.list': { params: z.object({}).strict(), result: z.array(managedPluginInfoSchema) },
  'plugin.read': { params: managedPluginIdSchema, result: managedPluginInfoSchema },
  'plugin.enable': { params: managedPluginIdSchema.extend({ enabled: z.boolean() }), result: managedPluginInfoSchema },
  'plugin.permissions.set': { params: packagePermissionSetSchema, result: managedPluginInfoSchema },
  'plugin.uninstall': { params: managedPluginIdSchema, result: managedPluginIdSchema.extend({ deleted: z.boolean(), removedVersions: z.number().int().nonnegative(), cleanupErrors: z.array(z.string()) }) },
  'plugin.component.set': { params: managedPluginIdSchema.extend({ revision, componentId: z.string(), enabled: z.boolean() }), result: managedPluginInfoSchema },
  'plugin.package.select': { params: managedPluginIdSchema.extend({ revision }), result: managedPluginInfoSchema },
  'plugin.install_preview': { params: z.object({ previewID: z.string().uuid(), activate: z.boolean(), enabled: z.boolean(), requireVerified: z.boolean() }).strict(), result: managedPluginInfoSchema },
} as const

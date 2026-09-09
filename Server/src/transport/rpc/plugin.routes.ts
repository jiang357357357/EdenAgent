import { managedPluginIdSchema, rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import { packagePermissionSetSchema } from '@eden/api'
import type { InstalledPackageRepository } from '../../modules/plugin-market/index.ts'
import { pluginDiffSchema, pluginLogQuerySchema } from '@eden/api'
import { z } from 'zod'
import { pluginDraftOperationSchema, pluginIdSchema, pluginVersionSchema, pluginActivationSchema, pluginDraftSchema,
  pluginGrantSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { PluginService } from '@eden/plugin-host'

export function pluginRoutes(plugins: PluginService, packages?: InstalledPackageRepository): Record<string, (value: JsonValue) => JsonValue | Promise<JsonValue>> {
  const handlers: Record<string, (value: JsonValue) => JsonValue | Promise<JsonValue>> = {
    'plugin.version.diff': value => { const input = pluginDiffSchema.parse(value); return toJson(plugins.management.diff(input.id, input.fromRevision, input.toRevision)) },
    'plugin.operation.list': value => { const input = pluginLogQuerySchema.parse(value); return toJson(plugins.operations.list(input.id, input.before, input.limit)) },
    'plugin.describe': () => plugins.describe(),
    'plugin.draft.save': value => { const params = pluginDraftSchema.parse(value); return toJson(plugins.drafts.save(params.manifest, params.source, params.expectedDraftRevision)) },
    'plugin.validate': async value => {
      const input = pluginDraftOperationSchema.parse(value)
      const built = await plugins.validate(input.id, undefined, input.expectedDraftRevision)
      return { id: built.manifest.id, revision: built.revision, draftRevision: built.draftRevision!, valid: true }
    },
    'plugin.test': async value => { const input = pluginDraftOperationSchema.parse(value); return toJson(await plugins.test(input.id, undefined, undefined, input.expectedDraftRevision)) },
    'plugin.install': async value => { const params = pluginVersionSchema.parse(value); return toJson(await plugins.install(params.id, params.revision)) },
    'plugin.activate': async value => { const params = pluginActivationSchema.parse(value); return toJson(await plugins.activate(params.id, params.revision, params.readRoot)) },
    'plugin.version.activate': async value => { const input = pluginActivationSchema.parse(value); return toJson(await plugins.activate(input.id, input.revision, input.readRoot)) },
    'plugin.disable': value => { plugins.disable(pluginIdSchema.parse(value).id); return { disabled: true } },
    'plugin.list': () => toJson([...plugins.management.list(), ...(packages?.list() ?? [])]),
    'plugin.read': value => { const { id } = managedPluginIdSchema.parse(value); return toJson(packages?.has(id) ? packages.read(id) : plugins.management.read(id)) },
    'plugin.version.list': () => toJson(plugins.versions.list()),
    'plugin.version.read': value => { const input = pluginVersionSchema.parse(value); return toJson(plugins.management.version(input.id, input.revision)) },
    'plugin.draft.list': () => toJson(plugins.management.drafts()),
    'plugin.draft.read': value => toJson(plugins.drafts.read(pluginIdSchema.parse(value).id)),
    'plugin.uninstall': value => { const { id } = managedPluginIdSchema.parse(value); return toJson(packages?.has(id) ? packages.remove(id) : plugins.uninstall(id)) },
    'plugin.enable': async value => {
      const input = managedPluginIdSchema.extend({ enabled: z.boolean() }).parse(value)
      if (packages?.has(input.id)) {
        if (input.enabled) return toJson(packages.enable(input.id))
        return toJson(packages.disable(input.id))
      }
      if (!input.enabled) plugins.disable(input.id)
      else {
        const installed = plugins.management.read(input.id)
        const root = installed.permissionGrants.find(grant => grant.decision === 'allowed')?.resource
        await plugins.activate(input.id, installed.revision, root)
      }
      return toJson(plugins.management.read(input.id))
    },
    'plugin.permissions.set': value => {
      const packageInput = packagePermissionSetSchema.parse(value)
      if (packages?.has(packageInput.id)) return toJson(packages.setPermissions(packageInput.id, packageInput.revision, packageInput.decisions))
      const params = pluginVersionSchema.extend({ decisions: z.array(z.object({ capability: z.literal('workspace.read'),
        resource: z.string().min(1), access: z.literal('read'), decision: z.enum(['allowed', 'denied']) }).strict()).max(1) }).parse(value)
      const installed = plugins.versions.read(params.id, params.revision)
      if (params.decisions.length && !installed.manifest.permissions.length) throw new Error('Plugin does not declare workspace.read')
      for (const decision of params.decisions) {
        if (decision.decision === 'denied') plugins.disable(params.id)
        plugins.activations.grant(params.id, params.revision, decision.resource, decision.decision === 'allowed')
      }
      return toJson(plugins.management.read(params.id))
    },
    'plugin.grant': value => {
      const params = pluginGrantSchema.parse(value)
      if (!params.allowed) plugins.disable(params.id)
      plugins.activations.grant(params.id, params.revision, params.readRoot, params.allowed)
      return { recorded: true }
    },
  }
  return Object.fromEntries(Object.entries(handlers).map(([method, handler]) => {
    const contract = Object.hasOwn(rpcMethods, method) ? rpcMethods[method as keyof typeof rpcMethods] : undefined
    return [method, contract ? contractHandler(contract, input => handler(toJson(input))) : handler]
  }))
}

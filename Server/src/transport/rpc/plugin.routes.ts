import { pluginIdSchema, pluginVersionSchema, pluginActivationSchema, pluginDraftSchema,
  pluginGrantSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { PluginService } from '@eden/plugin-host'

export function pluginRoutes(plugins: PluginService): Record<string, (value: JsonValue) => JsonValue | Promise<JsonValue>> {
  return {
    'plugin.describe': () => plugins.describe(),
    'plugin.draft.save': value => { const params = pluginDraftSchema.parse(value); return toJson(plugins.drafts.save(params.manifest, params.source)) },
    'plugin.validate': async value => {
      const built = await plugins.validate(pluginIdSchema.parse(value).id)
      return { id: built.manifest.id, revision: built.revision, valid: true }
    },
    'plugin.test': async value => toJson(await plugins.test(pluginIdSchema.parse(value).id)),
    'plugin.install': async value => { const params = pluginVersionSchema.parse(value); return toJson(await plugins.install(params.id, params.revision)) },
    'plugin.activate': async value => { const params = pluginActivationSchema.parse(value); return toJson(await plugins.activate(params.id, params.revision, params.readRoot)) },
    'plugin.disable': value => { plugins.disable(pluginIdSchema.parse(value).id); return { disabled: true } },
    'plugin.list': () => toJson(plugins.versions.list()),
    'plugin.grant': value => {
      const params = pluginGrantSchema.parse(value)
      if (!params.allowed) plugins.disable(params.id)
      plugins.activations.grant(params.id, params.revision, params.readRoot, params.allowed)
      return { recorded: true }
    },
  }
}

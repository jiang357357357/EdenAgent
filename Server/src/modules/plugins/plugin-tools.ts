import type { PluginService } from '@eden/plugin-host'
import { createHash } from 'node:crypto'
import type { RuntimeTool } from '@eden/runtime-pi'
import { pluginDraftOperationSchema, pluginManageSchema, pluginDraftSchema, pluginIdSchema, pluginVersionSchema,
  pluginActivationSchema, pluginInvokeSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { PermissionService } from '../permissions/index.ts'

export function pluginTools(plugins: PluginService, permissions: PermissionService, sessionId: string, turnId: string): RuntimeTool[] {
  const management: RuntimeTool = {
    name: 'eden_plugin', revision: 'eden.plugin-management.v1', executionMode: 'sequential',
    description: 'Create and manage isolated TypeScript tool plugins. First call describe({}) for manifest schema and constraints. Actions: read(id) returns current draftRevision; draft(manifest,source,expectedDraftRevision?) requires that revision to replace an existing draft, validate(id,expectedDraftRevision?), test(id,expectedDraftRevision?), install(id,revision), activate(id,revision,readRoot?), disable(id), list({}), invoke(id,revision,input). Test before installing. Activation exposes a named tool next turn; invoke can call the exact active revision now. Workspace grants require user RPC authorization and cannot be self-granted.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['describe', 'read', 'draft', 'validate', 'test', 'install', 'activate', 'disable', 'list', 'invoke'] }, args: { type: 'object' } }, required: ['action', 'args'], additionalProperties: false },
    async execute(input, context) {
      const command = pluginManageSchema.parse(input)
      if (command.action === 'describe') return plugins.describe()
      if (command.action === 'read') return toJson(plugins.drafts.read(pluginIdSchema.parse(command.args).id))
      if (command.action === 'list') return toJson(plugins.versions.list())
      if (command.action === 'validate') {
        const input = pluginDraftOperationSchema.parse(command.args)
        const built = await plugins.validate(input.id, context.signal, input.expectedDraftRevision)
        return { id: built.manifest.id, revision: built.revision, draftRevision: built.draftRevision!, valid: true }
      }
      // Exact request details are durable and visible before any plugin mutation or execution.
      const testInput = command.action === 'test' ? pluginDraftOperationSchema.parse(command.args) : undefined
      const testedRevision = testInput ? (await plugins.validate(testInput.id, context.signal, testInput.expectedDraftRevision)).revision : undefined
      await permissions.request({ ...context, sessionId, turnId }, `plugin.${command.action}`, testedRevision ? `plugin-test@${testedRevision}` : 'plugin-registry', command.args)
      context.signal.throwIfAborted()
      return managePlugin(plugins, command.action, command.args, context.signal, testedRevision)
    },
  }
  const active: RuntimeTool[] = plugins.activations.list().map(item => {
    const plugin = plugins.versions.read(item.id, item.revision)
    return {
      name: `plugin_${item.id.replaceAll('-', '_').slice(0, 24)}_${createHash('sha256').update(item.id).digest('hex').slice(0, 8)}_${plugin.manifest.tool.name.slice(0, 22)}`,
      revision: item.revision, description: plugin.manifest.tool.description, parameters: plugin.manifest.tool.parameters,
      async execute(input, context) {
        await permissions.request({ ...context, sessionId, turnId }, 'plugin.invoke', `${item.id}@${item.revision}`, toJson(input))
        return plugins.invoke(item.id, item.revision, toJson(input), context.signal)
      },
    }
  })
  return [management, ...active]
}

async function managePlugin(plugins: PluginService, action: string, args: JsonValue, signal: AbortSignal, testedRevision?: string): Promise<JsonValue> {
  if (action === 'draft') {
    const params = pluginDraftSchema.parse(args)
    return toJson(plugins.drafts.save(params.manifest, params.source, params.expectedDraftRevision))
  }
  if (action === 'test') { const input = pluginDraftOperationSchema.parse(args); return toJson(await plugins.test(input.id, signal, testedRevision, input.expectedDraftRevision)) }
  if (action === 'install') {
    const params = pluginVersionSchema.parse(args)
    return toJson(await plugins.install(params.id, params.revision, signal))
  }
  if (action === 'activate') {
    const params = pluginActivationSchema.parse(args)
    return toJson(await plugins.activate(params.id, params.revision, params.readRoot))
  }
  if (action === 'disable') { plugins.disable(pluginIdSchema.parse(args).id); return { disabled: true } }
  const params = pluginInvokeSchema.parse(args)
  return plugins.invoke(params.id, params.revision, params.input, signal)
}

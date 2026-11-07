import { z } from 'zod'
import { jsonValue, type JsonValue } from './json.ts'

export const extensionId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/)
export const extensionPath = z.string().min(1).max(1024).refine(value =>
  !/[\\:\x00-\x1f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'), 'Expected a package relative path')
export const extensionWhenSchema = z.object({
  sessionAvailable: z.boolean().optional(), sessionRunning: z.boolean().optional(), activeView: z.string().max(256).optional(),
}).strict()
const command = z.object({ id: extensionId, title: z.string().min(1).max(128), when: extensionWhenSchema.optional() }).strict()
const menu = z.object({ command: extensionId, location: z.enum(['toolbar', 'activity', 'view/title', 'view/item/context', 'editor/context']),
  view: extensionId.optional(), group: z.string().max(64).default('default'), order: z.number().int().min(-1000).max(1000).default(0),
  when: extensionWhenSchema.optional() }).strict()
const keybinding = z.object({ command: extensionId, key: z.string().min(1).max(80), when: extensionWhenSchema.optional() }).strict()
export const extensionSettingSchema = z.object({ type: z.enum(['string', 'number', 'boolean']),
  title: z.string().min(1).max(128), description: z.string().max(2000).default(''), default: jsonValue,
  enum: z.array(jsonValue).min(1).max(64).optional() }).strict().superRefine((setting, context) => {
  if (typeof setting.default !== setting.type || setting.enum?.some(value => typeof value !== setting.type)
    || setting.enum && !setting.enum.some(value => value === setting.default)) context.addIssue({ code: 'custom', message: 'Setting type, default and enum must agree' })
})
export const extensionContributionsSchema = z.object({
  commands: z.array(command).max(128).default([]), menus: z.array(menu).max(256).default([]),
  keybindings: z.array(keybinding).max(128).default([]),
  configuration: z.record(extensionId, extensionSettingSchema).default({}),
  statusBar: z.array(z.object({ id: extensionId, text: z.string().max(128), command: extensionId.optional(),
    alignment: z.enum(['left', 'right']).default('left'), priority: z.number().int().min(-1000).max(1000).default(0),
    when: extensionWhenSchema.optional() }).strict()).max(32).default([]),
}).strict().superRefine((value, context) => {
  const ids = new Set(value.commands.map(item => item.id))
  if (ids.size !== value.commands.length || new Set(value.statusBar.map(item => item.id)).size !== value.statusBar.length)
    context.addIssue({ code: 'custom', message: 'Duplicate contribution ID' })
  for (const item of [...value.menus, ...value.keybindings, ...value.statusBar])
    if (item.command && !ids.has(item.command)) context.addIssue({ code: 'custom', message: `Undeclared command: ${item.command}` })
})
export const extensionDocumentFields = {
  activationEvents: z.array(z.enum(['onStartup', 'onCommand', 'onView'])).min(1).max(3).default(['onCommand', 'onView']),
  contributes: extensionContributionsSchema.default({ commands: [], menus: [], keybindings: [], configuration: {}, statusBar: [] }),
}
export const extensionStateRequestSchema = z.object({ scope: z.enum(['global', 'workspace']),
  namespace: z.enum(['storage', 'configuration']), key: extensionId,
  value: jsonValue.optional(), expectedRevision: z.number().int().nonnegative().optional(), remove: z.boolean().default(false) }).strict()
export const extensionStateResultSchema = z.object({ value: jsonValue, revision: z.number().int().nonnegative() })
export const extensionTreeItemSchema = z.object({ id: z.string().min(1).max(256), label: z.string().min(1).max(256),
  description: z.string().max(1024).optional(), hasChildren: z.boolean().default(false), command: extensionId.optional(),
  arguments: z.array(jsonValue).max(32).default([]) }).strict()
export type ExtensionContributions = z.infer<typeof extensionContributionsSchema>
export type ExtensionWhen = z.infer<typeof extensionWhenSchema>
export type ExtensionTreeItem = Omit<z.output<typeof extensionTreeItemSchema>, 'hasChildren' | 'arguments'>
  & { hasChildren?: boolean; arguments?: JsonValue[] }

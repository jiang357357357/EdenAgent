import { z } from 'zod'
import { jsonValue } from './json.ts'
import { extensionDocumentFields, extensionPath } from './extension-contributions.ts'

export const PLUGIN_UI_API_VERSION = 1
export const PLUGIN_UI_MODULE_MAX_BYTES = 256 * 1024
export const pluginUiSlots = ['sidebar_panel', 'page', 'tool_card'] as const
export const extensionUiSlots = [...pluginUiSlots, 'full_page', 'bottom_panel', 'floating_window'] as const
const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/)
const relativePath = z.string().min(1).max(1024).refine(value => !/[\\:\x00-\x1f]/.test(value)
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'UI entry must be a package-relative path')
export const pluginUiViewSchema = z.object({
  id: identifier, title: z.string().min(1).max(128), slot: z.enum(pluginUiSlots),
  toolNames: z.array(z.string().min(1).max(256)).max(32).default([]),
}).strict().refine(view => view.slot !== 'tool_card' || view.toolNames.length > 0,
  { message: 'A tool card must declare the tool names it renders' })
export const pluginUiLegacyDocumentSchema = z.object({
  schemaVersion: z.literal(1), type: z.literal('module'), apiVersion: z.literal(PLUGIN_UI_API_VERSION),
  entry: relativePath, views: z.array(pluginUiViewSchema).min(1).max(32),
  capabilities: z.object({ sessionRead: z.boolean().default(false), sessionSend: z.boolean().default(false),
    tools: z.array(z.string().min(1).max(256)).max(64).default([]) }).strict()
    .default({ sessionRead: false, sessionSend: false, tools: [] }),
}).strict().refine(value => new Set(value.views.map(view => view.id)).size === value.views.length,
  { message: 'Duplicate UI view ID' })
export const extensionDocumentSchema = z.object({
  schemaVersion: z.literal(1), type: z.literal('module'), apiVersion: z.literal(2), entry: relativePath,
  views: z.array(z.object({ ...pluginUiViewSchema.shape, renderer: z.enum(['webview', 'tree', 'editor']).default('webview'),
    slot: z.enum(extensionUiSlots),
    entry: extensionPath.optional(), filePatterns: z.array(z.string().min(1).max(128).regex(/^(?:\*\.)?[^*\\/]+$/)).max(32).default([]) }).strict()
    .refine(view=>view.slot!=='tool_card'||view.toolNames.length>0,{message:'A tool card must declare the tool names it renders'})).max(32),
  capabilities: z.object({ sessionRead: z.boolean().default(false), sessionSend: z.boolean().default(false),
    tools: z.array(z.string().min(1).max(256)).max(64).default([]), documents: z.boolean().default(false) }).strict()
    .default({ sessionRead: false, sessionSend: false, tools: [], documents: false }),
  ...extensionDocumentFields,
}).strict().superRefine((value, context) => {
  if (new Set(value.views.map(view => view.id)).size !== value.views.length || value.views.some(view => view.id === '$extension'))
    context.addIssue({ code: 'custom', message: 'Duplicate or reserved view ID' })
  if (value.views.some(view => view.renderer !== 'tree' && !view.entry)) context.addIssue({ code: 'custom', message: 'Webviews require an HTML entry' })
  if (value.views.some(view => view.renderer === 'editor' && !view.filePatterns.length)) context.addIssue({ code: 'custom', message: 'Custom editors require file patterns' })
  if (value.views.some(view => view.renderer === 'editor') && !value.capabilities.documents) context.addIssue({ code: 'custom', message: 'Custom editors require document capability' })
  if (value.views.some(view => view.renderer === 'editor' && view.slot !== 'page')) context.addIssue({ code: 'custom', message: 'File editors require the page slot' })
  for (const menu of value.contributes.menus) if (menu.view && !value.views.some(view => view.id === menu.view))
    context.addIssue({ code: 'custom', message: 'Menu refers to an absent view' })
})
export const pluginUiDocumentSchema = z.union([pluginUiLegacyDocumentSchema, extensionDocumentSchema])
export const pluginUiModuleSchema = z.object({
  pluginId: identifier, pluginName: z.string(), componentId: identifier,
  revision: z.string().regex(/^[a-f0-9]{64}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  document: pluginUiDocumentSchema,
  configurationRevision: z.number().int().nonnegative().optional(),
  assets: z.record(z.string(), z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().nonnegative() })).optional(),
})
export const pluginUiIdentitySchema = pluginUiModuleSchema.pick({ pluginId: true, componentId: true, revision: true })
export const pluginUiContextSchema = pluginUiIdentitySchema.extend({ viewId: z.union([identifier, z.literal('$extension')]), sessionId: z.string().uuid().optional() })
export const pluginUiCallSchema = pluginUiContextSchema.extend({
  action: z.enum(['session.read', 'session.send', 'tool.call', 'extension.state', 'document.read', 'document.save']),
  input: z.record(z.string(), jsonValue).default({}), requestId: z.string().uuid(),
})
export const pluginUiReportSchema = pluginUiIdentitySchema.extend({ clientId: z.string().uuid(), viewId: identifier.optional(),
  status: z.enum(['loaded', 'unloaded', 'mounted', 'unmounted', 'failed']), error: z.string().max(2000).optional(),
  executionState: z.enum(['inactive', 'activating', 'ready', 'failed']).optional() }).strict()
export const pluginUiDiagnosticSchema = pluginUiContextSchema.extend({ clientId: z.string().uuid(),
  entries: z.array(z.object({ kind: z.enum(['error', 'unhandledrejection', 'console', 'network', 'csp']),
    message: z.string().min(1).max(2000) }).strict()).min(1).max(20) }).strict()
export const pluginUiRpcMethods = {
  'plugin.ui.list': { params: z.object({}).strict(), result: z.object({ modules: z.array(pluginUiModuleSchema),
    errors: z.array(z.object({ pluginId: z.string(), error: z.string() })) }) },
  'plugin.ui.read': { params: pluginUiIdentitySchema.strict(), result: pluginUiModuleSchema.extend({ source: z.string().max(PLUGIN_UI_MODULE_MAX_BYTES),
    resources: z.record(z.string(), z.string()).optional() }) },
  'plugin.ui.call': { params: pluginUiCallSchema.strict(), result: jsonValue },
  'plugin.ui.cancel': { params: z.object({ requestId: z.string().uuid() }).strict(), result: z.object({ cancelled: z.boolean() }) },
  'plugin.ui.operation': { params: pluginUiContextSchema.extend({ requestId: z.string().uuid() }).strict(),
    result: z.object({ state: z.enum(['waiting', 'approval', 'running', 'completed', 'unknown']) }) },
  'plugin.ui.report': { params: pluginUiReportSchema, result: z.object({ recorded: z.boolean() }) },
  'plugin.ui.diagnostic': { params: pluginUiDiagnosticSchema, result: z.object({ recorded: z.boolean() }) },
} as const
export type PluginUiDocument = z.infer<typeof pluginUiDocumentSchema>
export type PluginUiModule = z.infer<typeof pluginUiModuleSchema>
export type PluginUiCall = z.infer<typeof pluginUiCallSchema>
export type PluginUiContext = z.infer<typeof pluginUiContextSchema>
export type PluginUiReport = z.infer<typeof pluginUiReportSchema>
export type PluginUiDiagnostic = z.infer<typeof pluginUiDiagnosticSchema>

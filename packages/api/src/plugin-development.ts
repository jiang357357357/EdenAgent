import { z } from 'zod'
import { jsonValue } from './json.ts'
import { pluginIdSchema, pluginVersionSchema, pluginActivationSchema, pluginDraftSchema, pluginGrantSchema } from './plugins.ts'
import { pluginDiffSchema, pluginDiffResultSchema, pluginLogQuerySchema, pluginLogPageSchema } from './plugin-history.ts'

export const pluginTestReportSchema = z.object({
  revision: z.string().regex(/^[a-f0-9]{64}$/), passed: z.boolean(), testedAt: z.number().int(), backend: z.string(),
  cases: z.array(z.object({ index: z.number().int(), passed: z.boolean(), error: z.string().nullable() }).strict()),
}).strict()
export const pluginDraftContentSchema = z.object({ manifest: jsonValue, source: z.string() })
export const pluginDraftSummarySchema = z.object({ id: z.string(), name: z.string(), version: z.string(), updatedAt: z.number().int() })
export const pluginVersionSummarySchema = pluginVersionSchema.extend({ version: z.string(), active: z.boolean() })
const activation = pluginVersionSchema.extend({ readRoot: z.string().optional() })
export type PluginDraftContent = z.infer<typeof pluginDraftContentSchema>
export type PluginDraftSummary = z.infer<typeof pluginDraftSummarySchema>
export type PluginVersionSummary = z.infer<typeof pluginVersionSummarySchema>
export type PluginTestReport = z.infer<typeof pluginTestReportSchema>
export const pluginDevelopmentRpcMethods = {
  'plugin.version.diff': { params: pluginDiffSchema, result: pluginDiffResultSchema },
  'plugin.operation.list': { params: pluginLogQuerySchema, result: pluginLogPageSchema },
  'plugin.describe': { params: z.object({}).strict(), result: z.object({ manifestSchema: jsonValue, sourceExample: z.string(),
    handler: z.string(), dependencies: z.string(), schema: z.string(), limits: z.string(), workflow: z.string() }) },
  'plugin.draft.save': { params: pluginDraftSchema, result: pluginDraftContentSchema },
  'plugin.draft.read': { params: pluginIdSchema, result: pluginDraftContentSchema },
  'plugin.draft.list': { params: z.object({}).strict(), result: z.array(pluginDraftSummarySchema) },
  'plugin.validate': { params: pluginIdSchema, result: pluginVersionSchema.extend({ valid: z.literal(true) }) },
  'plugin.test': { params: pluginIdSchema, result: pluginTestReportSchema },
  'plugin.install': { params: pluginVersionSchema, result: pluginVersionSchema },
  'plugin.activate': { params: pluginActivationSchema, result: activation },
  'plugin.version.activate': { params: pluginActivationSchema, result: activation },
  'plugin.disable': { params: pluginIdSchema, result: z.object({ disabled: z.literal(true) }) },
  'plugin.version.list': { params: z.object({}).strict(), result: z.array(pluginVersionSummarySchema) },
  'plugin.version.read': { params: pluginVersionSchema, result: pluginDraftContentSchema.extend({ revision: z.string(), report: pluginTestReportSchema }) },
  'plugin.grant': { params: pluginGrantSchema, result: z.object({ recorded: z.literal(true) }) },
} as const

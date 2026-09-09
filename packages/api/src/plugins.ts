import { z } from 'zod'
import { jsonValue } from './json.ts'

export const pluginIdSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/) }).strict()
export const pluginVersionSchema = pluginIdSchema.extend({ revision: z.string().regex(/^[a-f0-9]{64}$/) })
export const pluginActivationSchema = pluginVersionSchema.extend({ readRoot: z.string().min(1).optional() })
export const pluginDraftSchema = z.object({ manifest: jsonValue, source: z.string().max(65536) }).strict()
export const pluginInvokeSchema = pluginVersionSchema.extend({ input: jsonValue })
export const pluginGrantSchema = pluginVersionSchema.extend({ readRoot: z.string().min(1), allowed: z.boolean() })
export const permissionListSchema = z.object({ sessionId: z.string().uuid().nullish() }).strict()
export const permissionResolveSchema = z.object({ requestId: z.string().uuid(), decision: z.enum(['once', 'always', 'deny']), message: z.string().max(2000).nullish() }).strict()
export const permissionRequestIdSchema = z.object({ requestId: z.string().uuid() }).strict()
export const pluginManageSchema = z.object({
  action: z.enum(['describe', 'draft', 'validate', 'test', 'install', 'activate', 'disable', 'list', 'invoke']),
  args: jsonValue,
}).strict()

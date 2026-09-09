import { z } from 'zod'
import { pluginIdSchema } from './plugins.ts'
const revision = z.string().regex(/^[a-f0-9]{64}$/)
export const pluginDiffSchema = pluginIdSchema.extend({ fromRevision: revision, toRevision: revision })
export const pluginLogQuerySchema = pluginIdSchema.extend({ before: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(), limit: z.number().int().min(1).max(100).default(30) })
export const pluginLogPageSchema = z.object({ items: z.array(z.object({ seq: z.number(), id: z.string(), action: z.string(), revision: z.string().nullable(),
  state: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']), startedAt: z.number(), finishedAt: z.number().nullable(), errorCode: z.string().nullable() })), hasMore: z.boolean(), nextCursor: z.number().nullable() })
const hunk = z.object({ changed: z.boolean(), startLine: z.number(), removed: z.array(z.string()), added: z.array(z.string()), unchangedPrefixLines: z.number(), unchangedSuffixLines: z.number() })
export const pluginDiffResultSchema = z.object({ id: z.string(), fromRevision: revision, toRevision: revision, source: hunk, manifest: hunk })
export type PluginLogPage = z.infer<typeof pluginLogPageSchema>
export type PluginDiffResult = z.infer<typeof pluginDiffResultSchema>

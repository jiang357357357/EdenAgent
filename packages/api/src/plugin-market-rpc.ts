import { z } from 'zod'
import { marketKeyIdSchema, marketKeyAddSchema, marketKeyInfoSchema } from './plugin-market.ts'
import { managedPluginInfoSchema } from './plugin-management.ts'
import { packageAssetListSchema, packageAssetExportSchema, packageAssetInfoSchema, packageAssetExportResultSchema } from './plugin-assets.ts'
export const marketUrlSchema = z.string().max(4096).refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash } catch { return false }
}, 'Market URLs must be credential-free HTTPS URLs')
export const marketSourceSchema = marketKeyIdSchema.extend({ name: z.string().min(1).max(256), url: marketUrlSchema,
  keyID: marketKeyIdSchema.shape.id, enabled: z.boolean().default(true) })
export const marketSourceInfoSchema = marketSourceSchema.extend({ indexRevision: z.string().nullable(), lastRefreshedAt: z.number().int().nullable(), lastError: z.string().nullable() })
export const marketReleaseInfoSchema = z.object({ sourceID: z.string(), pluginID: z.string(), name: z.string(), description: z.string(),
  version: z.string(), revision: z.string(), revoked: z.boolean(), revocationReason: z.string().nullable() })
export const pluginPreviewInfoSchema = managedPluginInfoSchema.pick({ id: true, name: true, description: true, version: true,
  revision: true, sourceType: true, sourceUri: true, components: true, permissions: true }).extend({
  previewID: z.string().uuid(), verified: z.boolean(), expiresAt: z.number().int(),
})
export type MarketSourceInfo = z.infer<typeof marketSourceInfoSchema>
export type MarketReleaseInfo = z.infer<typeof marketReleaseInfoSchema>
export type PluginPreviewInfo = z.infer<typeof pluginPreviewInfoSchema>
const empty = z.object({}).strict()
export const pluginMarketRpcMethods = {
  'plugin.recovery.permissions': { params: z.object({ sourceId: z.string().min(1).max(4096), after: z.string().max(16384).optional() }).strict(), result: z.object({
    items: z.array(z.object({ sourceId: z.string(), capability: z.string(), resource: z.string(), access: z.string(), originalDecision: z.enum(['allowed','denied']),
      originalRevision: z.string(), matchesVersion: z.boolean(), state: z.string(), currentDecision: z.enum(['allowed','denied']).nullable(), reviewedAt: z.number().nullable() })), nextCursor: z.string().nullable() }) },
  'plugin.recovery.list': { params: z.object({ after: z.string().max(4096).optional() }).strict(), result: z.object({
    items: z.array(z.object({ sourceId: z.string(), pluginId: z.string(), version: z.string(), revision: z.string(), state: z.string(), copied: z.boolean(), copiedAt: z.number().nullable() })), nextCursor: z.string().nullable() }) },
  'plugin.recovery.inspect': { params: z.object({ sourceId: z.string().min(1).max(4096) }).strict(), result: pluginPreviewInfoSchema },
  'plugin.asset.list': { params: packageAssetListSchema, result: z.array(packageAssetInfoSchema) },
  'plugin.asset.export': { params: packageAssetExportSchema, result: packageAssetExportResultSchema },
  'plugin.market.key.list': { params: empty, result: z.array(marketKeyInfoSchema) },
  'plugin.market.key.add': { params: marketKeyAddSchema, result: marketKeyInfoSchema },
  'plugin.market.key.revoke': { params: marketKeyIdSchema, result: z.object({ revoked: z.boolean() }) },
  'plugin.market.source.list': { params: empty, result: z.array(marketSourceInfoSchema) },
  'plugin.market.source.add': { params: marketSourceSchema, result: marketSourceInfoSchema },
  'plugin.market.source.remove': { params: marketKeyIdSchema, result: z.object({ deleted: z.boolean() }) },
  'plugin.market.source.refresh': { params: marketKeyIdSchema, result: marketSourceInfoSchema },
  'plugin.market.list': { params: z.object({ sourceID: z.string().min(1).nullish() }).strict(), result: z.array(marketReleaseInfoSchema) },
  'plugin.inspect': { params: z.object({ sourceType: z.literal('local'), sourceUri: z.string().min(1).max(4096) }).strict(), result: pluginPreviewInfoSchema },
  'plugin.market.inspect': { params: z.object({ sourceID: z.string().min(1), pluginID: z.string().min(1), version: z.string().min(1) }).strict(), result: pluginPreviewInfoSchema },
  'plugin.preview.discard': { params: z.object({ previewID: z.string().uuid() }).strict(), result: z.object({ deleted: z.boolean() }) },
} as const

import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import { z } from 'zod'
import { toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import { sourceSchema, sourceIdSchema, keySchema } from '../../modules/plugin-market/index.ts'
import type { MarketService } from '../../modules/plugin-market/index.ts'
export function pluginMarketRoutes(service: MarketService): Record<string, (input: JsonValue) => JsonValue | Promise<JsonValue>> {
  const repo = service.repository
  const handlers: Record<string, (input: JsonValue) => JsonValue | Promise<JsonValue>> = {
    'plugin.recovery.permissions': raw => {
      const input = rpcMethods['plugin.recovery.permissions'].params.parse(raw)
      if (!service.recovery) throw new Error('Plugin recovery is unavailable')
      return toJson(service.recovery.permissions(input.sourceId, input.after))
    },
    'plugin.recovery.list': raw => {
      const input = rpcMethods['plugin.recovery.list'].params.parse(raw)
      if (!service.recovery) throw new Error('Plugin recovery is unavailable')
      return toJson(service.recovery.list(input.after))
    },
    'plugin.recovery.inspect': async raw => toJson(await service.inspectRecovered(rpcMethods['plugin.recovery.inspect'].params.parse(raw).sourceId)),
    'plugin.inspect': async raw => { const input = z.object({ sourceType: z.literal('local'), sourceUri: z.string().min(1).max(4096) }).strict().parse(raw); return toJson(await service.inspectLocal(input.sourceUri)) },
    'plugin.install_preview': raw => {
      const input = z.object({ previewID: z.uuid(), activate: z.boolean(), enabled: z.boolean(), requireVerified: z.boolean() }).strict().parse(raw)
      const preview = service.previews.read(input.previewID)
      if (input.requireVerified && !preview.keyId) throw new Error('Installation requires a signature from a trusted key')
      return toJson(service.installed.install(preview, input.activate, input.enabled))
    },
    'plugin.component.set': raw => { const input = z.object({ id: z.string(), revision: z.string().regex(/^[a-f0-9]{64}$/), componentId: z.string(), enabled: z.boolean() }).strict().parse(raw); return toJson(service.installed.setComponent(input.id, input.revision, input.componentId, input.enabled)) },
    'plugin.package.select': raw => { const input = z.object({ id: z.string(), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(raw); return toJson(service.installed.select(input.id, input.revision)) },
    'plugin.market.inspect': async raw => { const input = z.object({ sourceID: z.string().min(1), pluginID: z.string().min(1), version: z.string().min(1) }).strict().parse(raw); return toJson(await service.inspect(input.sourceID, input.pluginID, input.version)) },
    'plugin.preview.discard': raw => { const input = z.object({ previewID: z.uuid() }).strict().parse(raw); return toJson(service.previews.discard(input.previewID)) },
    'plugin.market.source.list': () => toJson(repo.list()),
    'plugin.market.source.add': raw => toJson(repo.add(sourceSchema.parse(raw))),
    'plugin.market.source.remove': raw => toJson(repo.remove(sourceIdSchema.parse(raw).id)),
    'plugin.market.source.refresh': async raw => toJson(await service.refresh(sourceIdSchema.parse(raw).id)),
    'plugin.market.list': raw => { const input = z.object({ sourceID: z.string().nullable().optional() }).strict().parse(raw); return toJson(repo.releases(input.sourceID ?? undefined)) },
    'plugin.market.key.list': () => toJson(repo.keys()),
    'plugin.market.key.add': raw => { const input = keySchema.parse(raw); return toJson(repo.addKey(input.id, input.publicKey)) },
    'plugin.market.key.revoke': raw => toJson(repo.revokeKey(sourceIdSchema.parse(raw).id)),
  }
  return Object.fromEntries(Object.entries(handlers).map(([method, handler]) => {
    const contract = Object.hasOwn(rpcMethods, method) ? rpcMethods[method as keyof typeof rpcMethods] : undefined
    return [method, contract ? contractHandler(contract, input => handler(toJson(input))) : handler]
  }))
}

import { rpcMethods, toJson } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import type { JsonValue } from '@eden/api'
import type { ModelService } from '../../modules/models/index.ts'
import type { SessionService } from '../../modules/sessions/index.ts'
import type { MonBindingService } from '../../modules/mon/index.ts'

export function modelRoutes(models: ModelService, sessions: SessionService, mon?: MonBindingService): Record<string, (value: JsonValue) => JsonValue | Promise<JsonValue>> {
  return {
    ...(mon ? {
      'model.mon.children.list': contractHandler(rpcMethods['model.mon.children.list'], input => mon.childProfiles(input.sessionId)),
      'model.mon.children.catalog': contractHandler(rpcMethods['model.mon.children.catalog'], input => mon.childCatalog(input.sessionId)),
      'model.mon.children.bind': contractHandler(rpcMethods['model.mon.children.bind'], input => mon.bindChildProfile(input.sessionId, input.entityId, input.expectedRevision)),
      'model.mon.children.remove': contractHandler(rpcMethods['model.mon.children.remove'], input => mon.removeChildProfile(input.sessionId, input.key, input.expectedRevision)),
    } : {}),
    'model.local.profiles.list': contractHandler(rpcMethods['model.local.profiles.list'], () => models.localProfiles().list()),
    'model.local.profiles.save': contractHandler(rpcMethods['model.local.profiles.save'], input => models.localProfiles().save(input.model, input.expectedRevision)),
    'model.local.profiles.remove': contractHandler(rpcMethods['model.local.profiles.remove'], input => models.localProfiles().remove(input.key, input.expectedRevision)),
    'model.pricing.read': contractHandler(rpcMethods['model.pricing.read'], input => {
      sessions.repository.read(input.sessionId)
      if (!models.pricing) throw new Error('Model pricing storage is unavailable')
      return models.pricing.read(models.pricingModel(input))
    }),
    'model.pricing.set': contractHandler(rpcMethods['model.pricing.set'], input => {
      sessions.repository.read(input.selection.sessionId)
      if (!models.pricing) throw new Error('Model pricing storage is unavailable')
      return models.pricing.set(models.pricingModel(input.selection), input.expectedModelKey, input.expectedRevision, input.rates, input.note)
    }),
    'model.read': contractHandler(rpcMethods['model.read'], params => {
      const participants = params.sessionId ? sessions.repository.read(params.sessionId).participants : undefined
      return toJson(models.read(params.sessionId ?? undefined, participants))
    }),
    ...(mon ? { 'model.catalog': contractHandler(rpcMethods['model.catalog'], input => mon.catalog(input)) } : {}),
    ...(mon ? { 'model.select': contractHandler(rpcMethods['model.select'], input => mon.select(input)) } : {}),
    ...(mon ? { 'mon.sync.legacy.resolve': contractHandler(rpcMethods['mon.sync.legacy.resolve'], input => mon.resolveLegacySync(input)) } : {}),
    ...(mon ? { 'mon.sync.legacy.replay': contractHandler(rpcMethods['mon.sync.legacy.replay'], input => mon.replayLegacySync(input)) } : {}),
    ...(mon ? { 'mon.sync.status': contractHandler(rpcMethods['mon.sync.status'], input => mon.syncStatus(toJson(input))) } : {}),
    ...(mon ? { 'mon.operation.list': contractHandler(rpcMethods['mon.operation.list'], input => mon.listOperations(input)) } : {}),
  }
}

import { modelReadSchema, modelCatalogSchema, modelSelectSchema, monOperationListSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { ModelService } from '../../modules/models/index.ts'
import type { SessionService } from '../../modules/sessions/index.ts'
import type { MonBindingService } from '../../modules/mon/index.ts'

export function modelRoutes(models: ModelService, sessions: SessionService, mon?: MonBindingService): Record<string, (value: JsonValue) => JsonValue | Promise<JsonValue>> {
  return {
    'model.read': value => {
      const params = modelReadSchema.parse(value)
      const participants = params.sessionId ? sessions.repository.read(params.sessionId).participants : undefined
      return toJson(models.read(params.sessionId ?? undefined, participants))
    },
    ...(mon ? { 'model.catalog': (value: JsonValue) => mon.catalog(modelCatalogSchema.parse(value)) } : {}),
    ...(mon ? { 'model.select': (value: JsonValue) => mon.select(modelSelectSchema.parse(value)) } : {}),
    ...(mon ? { 'mon.operation.list': (value: JsonValue) => mon.listOperations(monOperationListSchema.parse(value)) } : {}),
  }
}

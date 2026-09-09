import { sessionIdSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { DirectorRunRepository } from '../../modules/director/index.ts'

export function directorRoutes(directors: DirectorRunRepository): Record<string, (params: JsonValue) => JsonValue> {
  return { 'director.list': params => toJson(directors.list(sessionIdSchema.parse(params).sessionId)) }
}

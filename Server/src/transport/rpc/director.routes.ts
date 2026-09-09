import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import type { DirectorRunRepository } from '../../modules/director/index.ts'

export function directorRoutes(directors: DirectorRunRepository) {
  return { 'director.list': contractHandler(rpcMethods['director.list'], input => directors.list(input.sessionId)) }
}

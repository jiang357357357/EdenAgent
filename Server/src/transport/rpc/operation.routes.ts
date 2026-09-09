import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import type { SessionRepository } from '../../modules/sessions/session-repository.ts'
import { OperationRepository } from '../../modules/operations/repository.ts'
export function operationRoutes(sessions: SessionRepository) {
  const operations = new OperationRepository(sessions)
  return {
    'operation.list': contractHandler(rpcMethods['operation.list'], input => operations.list(input)),
    'operation.resolve': contractHandler(rpcMethods['operation.resolve'], input => operations.resolve(input)),
  }
}

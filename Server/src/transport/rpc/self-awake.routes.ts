import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import type { SelfAwakeRepository, SelfAwakeActions } from '../../modules/self-awake/index.ts'

export function selfAwakeRoutes(repository: SelfAwakeRepository, actions: SelfAwakeActions) {
  return {
    'self_awake.action.resume': contractHandler(rpcMethods['self_awake.action.resume'], ({ runId }) => {
      actions.repository.resume(runId); actions.wake(); return { runId, state: 'accepted' }
    }),
    'self_awake.list': contractHandler(rpcMethods['self_awake.list'], input => repository.list(input)),
    'self_awake.execution': contractHandler(rpcMethods['self_awake.execution'], input => repository.execution(input.runId)),
  }
}

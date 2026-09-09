import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import type { SelfAwakeRepository, SelfAwakeActions, SelfAwakeService } from '../../modules/self-awake/index.ts'

export function selfAwakeRoutes(repository: SelfAwakeRepository, actions: SelfAwakeActions, service: SelfAwakeService) {
  return {
    'self_awake.run.review': contractHandler(rpcMethods['self_awake.run.review'], input => repository.runReview(input.runId)),
    'self_awake.run.resolve': contractHandler(rpcMethods['self_awake.run.resolve'], input => repository.resolveRun(input.runId, input.fingerprint, input.decision, input.note)),
    'self_awake.notification.review': contractHandler(rpcMethods['self_awake.notification.review'], input => repository.notificationReview(input.runId)),
    'self_awake.notification.resolve': contractHandler(rpcMethods['self_awake.notification.resolve'], input => repository.resolveNotification(input.runId, input.fingerprint, input.decision, input.note)),
    'self_awake.job.preview': contractHandler(rpcMethods['self_awake.job.preview'], input => service.recovery.preview(input.id)),
    'self_awake.job.resubmit': contractHandler(rpcMethods['self_awake.job.resubmit'], input => service.recovery.resubmit(input.id, input.fingerprint, input.note)),
    'self_awake.action.resume': contractHandler(rpcMethods['self_awake.action.resume'], ({ runId }) => {
      actions.repository.resume(runId); actions.wake(); return { runId, state: 'accepted' }
    }),
    'self_awake.list': contractHandler(rpcMethods['self_awake.list'], input => repository.list(input)),
    'self_awake.execution': contractHandler(rpcMethods['self_awake.execution'], input => repository.execution(input.runId)),
  }
}

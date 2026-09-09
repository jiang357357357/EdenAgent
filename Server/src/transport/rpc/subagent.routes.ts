import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import type { SubagentService } from '../../modules/subagents/index.ts'
export function subagentRoutes(service: SubagentService) {
  return {
    'agent.recovery.mailbox.list': contractHandler(rpcMethods['agent.recovery.mailbox.list'], input => service.repository.mailboxRecovery().list(input.sessionId, input.after)),
    'agent.recovery.mailbox.followup.preview': contractHandler(rpcMethods['agent.recovery.mailbox.followup.preview'], input => service.repository.mailboxRecovery().followupSource(input.sessionId, input.id, input.fingerprint)),
    'agent.recovery.mailbox.followup.apply': contractHandler(rpcMethods['agent.recovery.mailbox.followup.apply'], input => service.resumeMailboxFollowup(input.sessionId, input.id, input.fingerprint, input.note)),
    'agent.recovery.mailbox.followup.abandon': contractHandler(rpcMethods['agent.recovery.mailbox.followup.abandon'], input => service.repository.mailboxRecovery().abandonFollowup(input.sessionId, input.id, input.fingerprint, input.note)),
    'agent.recovery.mailbox.resolve': contractHandler(rpcMethods['agent.recovery.mailbox.resolve'], input => service.repository.mailboxRecovery().resolve(input.sessionId, input.id, input.fingerprint, input.decision, input.note)),
    'agent.recovery.read': contractHandler(rpcMethods['agent.recovery.read'], input => service.recoveryStatus(input.agentId)),
    'agent.recovery.reopen': contractHandler(rpcMethods['agent.recovery.reopen'], input => service.reopenHistorical(input.agentId, input.note)),
    'agent.job.resubmit': contractHandler(rpcMethods['agent.job.resubmit'], input => service.resubmitJob(input.agentId, input.jobId, input.expectedUpdatedAt, input.note)),
    'agent.recovery.deadline': contractHandler(rpcMethods['agent.recovery.deadline'], input => service.repository.renewDeadline(input)),
    'agent.recovery.usage.preview': contractHandler(rpcMethods['agent.recovery.usage.preview'], input => service.repository.baselineRecovery().preview(input.agentId)),
    'agent.recovery.usage.apply': contractHandler(rpcMethods['agent.recovery.usage.apply'], input => {
      service.repository.baselineRecovery().apply(input.agentId, input.fingerprint, input.tokens, input.costMicrousd, input.note)
      return service.repository.read(input.agentId)
    }),
    'agent.recovery.policy': contractHandler(rpcMethods['agent.recovery.policy'], input => service.restorePolicy(input)),
    'agent.recovery.model.sources': contractHandler(rpcMethods['agent.recovery.model.sources'], input => service.recoveredModelSources(input.agentId)),
    'agent.recovery.model.preview': contractHandler(rpcMethods['agent.recovery.model.preview'], input => service.previewRecoveredModel(input.agentId, input.actorId)),
    'agent.recovery.model.apply': contractHandler(rpcMethods['agent.recovery.model.apply'], input => service.applyRecoveredModel(input.agentId, input.fingerprint, input.note, input.actorId)),
    'agent.workspace.restore': contractHandler(rpcMethods['agent.workspace.restore'], input => service.repository.restoreWorkspace(input.agentId, input.workspaceRoot)),
    'agent.roles.import.preview': contractHandler(rpcMethods['agent.roles.import.preview'], input => service.repository.roleImport().preview(input)),
    'agent.roles.import.apply': contractHandler(rpcMethods['agent.roles.import.apply'], input => service.repository.roleImport().apply(input.previewId)),
    'agent.requests.list': contractHandler(rpcMethods['agent.requests.list'], input => service.repository.requestReview().list(input.agentId, input.after)),
    'agent.requests.review': contractHandler(rpcMethods['agent.requests.review'], input => service.repository.requestReview().resolve(input.agentId, input.requestId, input.tokens, input.costMicrousd, input.note)),
    'agent.roles': contractHandler(rpcMethods['agent.roles'], () => service.repository.roles().list()),
    'agent.roles.remove': contractHandler(rpcMethods['agent.roles.remove'], input => service.repository.roles().remove(input.name, input.scope, input.expectedWorkspaceRoot, input.expectedRevision)),
    'agent.roles.edit': contractHandler(rpcMethods['agent.roles.edit'], input => service.repository.roles().edit(input.name, input.scope)),
    'agent.roles.save': contractHandler(rpcMethods['agent.roles.save'], input => service.repository.roles().save(input.definition, input.expectedRevision, input.scope, input.expectedWorkspaceRoot)),
    'agent.spawn': contractHandler(rpcMethods['agent.spawn'], input => service.spawn(input)),
    'agent.list': contractHandler(rpcMethods['agent.list'], input => service.list(input.sessionId)),
    'agent.read': contractHandler(rpcMethods['agent.read'], input => service.read(input.agentId)),
    'agent.send': contractHandler(rpcMethods['agent.send'], input => service.send(input.agentId, input.message, undefined, input.idempotencyKey)),
    'agent.followup': contractHandler(rpcMethods['agent.followup'], input => service.followup(input.agentId, input.message, input.idempotencyKey)),
    'agent.interrupt': contractHandler(rpcMethods['agent.interrupt'], input => service.interrupt(input.agentId)),
  }
}

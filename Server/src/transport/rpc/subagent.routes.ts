import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import type { SubagentService } from '../../modules/subagents/index.ts'
export function subagentRoutes(service: SubagentService) {
  return {
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

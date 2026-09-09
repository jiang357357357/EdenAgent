import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import type { SubagentService } from '../../modules/subagents/index.ts'
export function subagentRoutes(service: SubagentService) {
  return {
    'agent.spawn': contractHandler(rpcMethods['agent.spawn'], input => service.spawn(input)),
    'agent.list': contractHandler(rpcMethods['agent.list'], input => service.list(input.sessionId)),
    'agent.read': contractHandler(rpcMethods['agent.read'], input => service.read(input.agentId)),
    'agent.send': contractHandler(rpcMethods['agent.send'], input => service.send(input.agentId, input.message, undefined, input.idempotencyKey)),
    'agent.followup': contractHandler(rpcMethods['agent.followup'], input => service.followup(input.agentId, input.message, input.idempotencyKey)),
    'agent.interrupt': contractHandler(rpcMethods['agent.interrupt'], input => service.interrupt(input.agentId)),
  }
}

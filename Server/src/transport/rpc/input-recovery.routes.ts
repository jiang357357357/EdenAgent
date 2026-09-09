import { rpcMethods } from '@eden/api'
import { InputRecoveryRepository } from '../../modules/sessions/index.ts'
import type { SessionRepository } from '../../modules/sessions/index.ts'
import type { SessionService } from '../../modules/sessions/index.ts'
import { contractHandler } from './contract-handler.ts'
export function inputRecoveryRoutes(sessions: SessionRepository, service: SessionService) {
  const recovery = new InputRecoveryRepository(sessions)
  return {
    'input.resubmission.preview': contractHandler(rpcMethods['input.resubmission.preview'], input => service.resubmissionPreview(input.sessionId, input.id)),
    'input.resubmission.apply': contractHandler(rpcMethods['input.resubmission.apply'], input => service.resubmit(input.sessionId, input.id, input.fingerprint, input.note)),
    'input.recovery.list': contractHandler(rpcMethods['input.recovery.list'], input => recovery.list(input.sessionId, input.after, input.includeCancelled)),
    'input.recovery.resolve': contractHandler(rpcMethods['input.recovery.resolve'], input => recovery.resolve(input.sessionId, input.id, input.fingerprint, input.decision, input.note)),
  }
}

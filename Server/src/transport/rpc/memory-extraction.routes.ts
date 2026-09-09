import { rpcMethods } from '@eden/api'
import { contractHandler } from './contract-handler.ts'
import type { MemoryExtractionService } from '../../modules/memories/index.ts'

export function memoryExtractionRoutes(service: MemoryExtractionService) {
  return {
    'memory.extraction.candidates': contractHandler(rpcMethods['memory.extraction.candidates'], input => service.candidates(input.sessionId, input.after, input.limit)),
    'memory.extraction.resume': contractHandler(rpcMethods['memory.extraction.resume'], input => service.resume(input.sessionId, input.jobId, input.revision)),
  }
}

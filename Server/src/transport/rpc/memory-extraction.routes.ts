import { memoryCandidatesListSchema, memoryCandidatesResumeSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { MemoryExtractionService } from '../../modules/memories/index.ts'

export function memoryExtractionRoutes(service: MemoryExtractionService): Record<string, (params: JsonValue) => JsonValue> {
  return {
    'memory.extraction.candidates': params => {
      const value = memoryCandidatesListSchema.parse(params)
      return toJson(service.candidates(value.sessionId, value.after, value.limit))
    },
    'memory.extraction.resume': params => {
      const value = memoryCandidatesResumeSchema.parse(params)
      return toJson(service.resume(value.sessionId, value.jobId, value.revision))
    },
  }
}

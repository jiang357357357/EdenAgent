import { z } from 'zod'
import { sessionIdSchema } from './rpc.ts'
import { directorRunSchema } from './director.ts'
import { memoryCandidatesListSchema, memoryCandidatesPageSchema, memoryCandidatesResumeSchema } from './memory-extractions.ts'
export const reasoningRpcMethods = {
  'director.list': { params: sessionIdSchema, result: z.array(directorRunSchema) },
  'memory.extraction.candidates': { params: memoryCandidatesListSchema, result: memoryCandidatesPageSchema },
  'memory.extraction.resume': { params: memoryCandidatesResumeSchema, result: z.object({ jobId: z.string().uuid(), state: z.literal('accepted') }) },
} as const

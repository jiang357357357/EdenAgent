import { z } from 'zod'
import { memoryKindSchema } from './memories.ts'

export const memoryCandidatesListSchema = z.object({ sessionId: z.uuid(),
  after: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(), limit: z.number().int().min(1).max(100).optional(),
}).strict()
export const memoryCandidatesResumeSchema = z.object({ sessionId: z.uuid(), jobId: z.uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()

export const memoryCandidateViewSchema = z.object({
  id: z.uuid(), sessionId: z.uuid(), turnId: z.uuid(), actorId: z.string(), scopeKey: z.string(),
  candidates: z.array(z.object({ kind: memoryKindSchema, content: z.string(), confidence: z.number().min(0.85).max(1) })),
  revision: z.string().regex(/^[a-f0-9]{64}$/), processing: z.boolean(), createdAt: z.number(), updatedAt: z.number(),
})
export const memoryCandidatesPageSchema = z.object({ items: z.array(memoryCandidateViewSchema), nextCursor: z.string().nullable() })
export type MemoryCandidateView = z.infer<typeof memoryCandidateViewSchema>
export type MemoryCandidatesPage = z.infer<typeof memoryCandidatesPageSchema>
export type MemoryCandidatesList = z.infer<typeof memoryCandidatesListSchema>
export type MemoryCandidatesResume = z.infer<typeof memoryCandidatesResumeSchema>

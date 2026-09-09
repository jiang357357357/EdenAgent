import { createHash } from 'node:crypto'
import { parseMemoryCandidates } from './extraction.ts'
import type { MemoryExtractionJob } from './extraction-repository.ts'

export function extractionApproval(job: MemoryExtractionJob) {
  const candidates = parseMemoryCandidates(JSON.stringify({ memories: job.candidates }))
  if (JSON.stringify(candidates) !== JSON.stringify(job.candidates)) throw new Error('Memory candidates are not canonical')
  const source = { jobId: job.id, inputId: job.inputId, actorId: job.actorId,
    scope: { scopeType: 'agent_character', scopeKey: job.scopeKey }, candidates }
  const revision = createHash('sha256').update(JSON.stringify(source)).digest('hex')
  return { capability: 'memory.write', resource: `memory-extraction:${job.id}`, details: { ...source, revision } }
}

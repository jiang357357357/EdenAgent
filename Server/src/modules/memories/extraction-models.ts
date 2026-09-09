import { isDeepStrictEqual } from 'node:util'
import type { ModelService } from '../models/index.ts'
import type { MemoryExtractionRepository, MemoryExtractionJob } from './extraction-repository.ts'

/** Resolves credentials only from the current host binding, then checks the accepted source descriptor. */
export class MemoryExtractionModels {
  constructor(private readonly jobs: MemoryExtractionRepository, private readonly models: ModelService) {}

  async resolve(job: MemoryExtractionJob, signal: AbortSignal) {
    signal.throwIfAborted()
    job = this.jobs.read(job.id)
    const saved = this.jobs.modelSnapshot(job.id)
    const model = saved.multi ? this.models.resolveActorModel(job.sessionId, job.actorId) : this.models.resolve(job.sessionId)
    if (!model) throw new Error('Memory extraction model binding is not restored')
    const descriptor = { id: model.id, provider: model.provider, baseUrl: model.baseUrl, contextWindow: model.contextWindow, maxTokens: model.maxTokens }
    if (!isDeepStrictEqual(saved.model, descriptor)) throw new Error('Memory extraction source model binding changed')
    return structuredClone(model)
  }
}

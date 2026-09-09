import { rpcMethods, type JsonValue } from '@eden/api'
import type { JobRepository } from '../../modules/jobs/index.ts'
import { contractHandler } from './contract-handler.ts'
export function jobRoutes(jobs: JobRepository): Record<string, (params: JsonValue) => Promise<JsonValue>> {
  return {
    'job.list': contractHandler(rpcMethods['job.list'], input => jobs.list(input)),
    'job.read': contractHandler(rpcMethods['job.read'], input => jobs.read(input.id)),
    'job.cancel': contractHandler(rpcMethods['job.cancel'], input => jobs.cancel(input.id)),
  }
}

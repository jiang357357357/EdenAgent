import { z } from 'zod'
import { modelEndpointSchema } from '@eden/api'
import type { MonServiceIdentity } from '@eden/integrations'
export function monServiceIdentity(origin: 'mon' | 'local', env: NodeJS.ProcessEnv): MonServiceIdentity | undefined {
  if (origin !== 'mon' || (!env.MON_SERVICE_SHARED_SECRET && !env.MON_SERVICE_USER_ID)) return undefined
  return z.object({ secret: z.string().min(1).max(8192), userId: z.string().trim().min(1).max(128), coreBaseUrl: modelEndpointSchema }).parse({
    secret: env.MON_SERVICE_SHARED_SECRET, userId: env.MON_SERVICE_USER_ID, coreBaseUrl: env.MON_CORE_BASE_URL ?? 'http://127.0.0.1:40011',
  })
}

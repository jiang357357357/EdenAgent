import { z } from 'zod'
export const migrationRpcMethods = {
  'runtime.status': { params: z.object({}).strict(), result: z.object({ mode: z.literal('runtime'),
    runtimeOrigin: z.enum(['mon','local']), automaticExecution: z.boolean() }) },
} as const

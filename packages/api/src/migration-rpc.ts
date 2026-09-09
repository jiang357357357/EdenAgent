import { z } from 'zod'
import { jsonValue } from './json.ts'
export const migrationRpcMethods = {
  'runtime.status': { params: z.object({}).strict(), result: z.object({ mode: z.enum(['runtime','migration-review']),
    runtimeOrigin: z.enum(['mon','local']), automaticExecution: z.boolean() }) },
  'migration.status': { params: z.object({}).strict(), result: jsonValue },
} as const

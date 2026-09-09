import { z } from 'zod'
import { jsonValue } from './json.ts'
export const operationListSchema = z.object({ sessionId: z.string().uuid().nullish(), state: z.string().max(64).nullish(), limit: z.number().int().min(1).max(500).default(100) }).strict()
export const operationResolveSchema = z.object({ operationId: z.string().min(1).max(1024), decision: z.enum(['retry', 'abandon']) }).strict()
export const operationInfoSchema = z.object({ operationId: z.string(), sessionId: z.string().uuid(), turnId: z.string().uuid(),
  toolCallId: z.string(), toolName: z.string(), capability: z.string(), resource: z.string(), state: z.string(),
  request: jsonValue, result: jsonValue, error: jsonValue, createdAt: z.number().int(), updatedAt: z.number().int() })
export const operationRpcMethods = {
  'operation.list': { params: operationListSchema, result: z.array(operationInfoSchema) },
  'operation.resolve': { params: operationResolveSchema, result: operationInfoSchema },
} as const

export type OperationInfo = z.infer<typeof operationInfoSchema>

import { z } from 'zod'
import { jsonValue } from './json.ts'
import { agentReadSchema, agentListSchema, agentMessageRequestSchema, agentSpawnSchema } from './subagents.ts'
export const agentThreadInfoSchema = z.object({
  id: z.string().uuid(), sessionId: z.string().uuid(), childSessionId: z.string().uuid(), parentId: z.string().uuid().nullable(),
  agentPath: z.string(), taskName: z.string(), role: z.string(), status: z.string(), result: jsonValue, error: z.string().nullable(),
  createdAt: z.number().int(), updatedAt: z.number().int(), startedAt: z.number().int().nullable(), completedAt: z.number().int().nullable(),
  config: z.object({ depth: z.number().int(), maxTurns: z.number().int(), maxModelRequests: z.number().int(), maxToolCalls: z.number().int() }), usage: z.object({ turns: z.number().int(), modelRequests: z.number().int(), toolCalls: z.number().int() }),
  deadlineAt: z.number().int().nullable(), coordinationBatchId: z.null(),
})
export type AgentThreadInfo = z.infer<typeof agentThreadInfoSchema>
export const subagentRpcMethods = {
  'agent.spawn': { params: agentSpawnSchema, result: agentThreadInfoSchema },
  'agent.list': { params: agentListSchema, result: z.array(agentThreadInfoSchema) },
  'agent.read': { params: agentReadSchema, result: agentThreadInfoSchema },
  'agent.send': { params: agentMessageRequestSchema, result: agentThreadInfoSchema },
  'agent.followup': { params: agentMessageRequestSchema, result: agentThreadInfoSchema },
  'agent.interrupt': { params: agentReadSchema, result: agentThreadInfoSchema },
} as const

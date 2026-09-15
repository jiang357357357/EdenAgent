import { z } from 'zod'
import { skillNameSchema } from './skills.ts'
const toolName = z.string().min(1).max(200)
  .refine(value => !value.startsWith('eden_'), 'eden_ 前缀的工具名称已经停用，请使用当前工具名称')
const names = z.array(toolName).max(256)
export const subagentRoleDefinitionSchema = z.object({ name: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  description: z.string().trim().min(1).max(1000), instructions: z.string().trim().min(1).max(32000),
  skills: z.array(skillNameSchema).max(32).refine(value => new Set(value).size === value.length, 'Role skills must be distinct').default([]),
  model: z.string().trim().min(1).max(500).nullable().default(null),
  reasoning: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).nullable().default(null),
  sandboxMode: z.enum(['inherit', 'read-only', 'workspace-write']), allowedTools: names.nullable().default(null), deniedTools: names.default([]),
  maxTurns: z.number().int().min(1).max(1024), maxModelRequests: z.number().int().min(1).max(128).default(128),
  maxToolCalls: z.number().int().min(1).max(10000).default(256), maxTokens: z.number().int().min(1).max(100000000).default(1000000),
  maxCostMicrousd: z.number().int().min(1).max(1000000000).nullable().default(null), timeoutMs: z.number().int().min(1000).max(86400000).default(1800000),
}).strict()
export const subagentRoleInfoSchema = subagentRoleDefinitionSchema.extend({ revision: z.string().uuid().nullable(), source: z.enum(['builtin','user','project']), workspaceRoot: z.string() })
export type SubagentRoleDefinition = z.infer<typeof subagentRoleDefinitionSchema>

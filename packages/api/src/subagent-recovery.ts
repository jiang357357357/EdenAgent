import { z } from 'zod'

export const subagentRecoverySchema = z.object({
  agentId: z.string().uuid(), childSessionId: z.string().uuid(), legacyState: z.string().nullable(),
  sessionStatus: z.string(), workspaceRoot: z.string().nullable(),
  checks: z.array(z.object({ key: z.string(), satisfied: z.boolean(), detail: z.string() })),
  historicalConfigurationHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
})
export type SubagentRecovery = z.infer<typeof subagentRecoverySchema>
export const subagentPolicyRecoverySchema = z.object({
  agentId: z.string().uuid(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  workspaceRoot: z.string().min(1).max(4096), role: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  expectedRoleRevision: z.string().uuid().nullable(),
  historicalPolicy: z.object({ sandboxMode: z.enum(['inherit', 'read-only', 'workspace-write']),
    allowedTools: z.array(z.string().min(1).max(200)).max(256),
    deniedTools: z.array(z.string().min(1).max(200)).max(256) }).strict(),
  note: z.string().trim().min(1).max(4000), confirmHistoricalRestrictions: z.literal(true),
}).strict()
export type SubagentPolicyRecovery = z.infer<typeof subagentPolicyRecoverySchema>
export const subagentModelRecoveryPlanSchema = z.object({
  agentId: z.string().uuid(), parentSessionId: z.string().uuid(), actorId: z.string().nullable(), origin: z.enum(['mon', 'local']),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), provider: z.string(), modelId: z.string(),
  baseUrl: z.string(), reasoning: z.string(), contextWindow: z.number().int(), maxTokens: z.number().int(),
})
export type SubagentModelRecoveryPlan = z.infer<typeof subagentModelRecoveryPlanSchema>
export const subagentBaselinePlanSchema = z.object({ agentId: z.string().uuid(), fingerprint: z.string(),
  tokens: z.number().int().nonnegative(), costMicrousd: z.number().int().nonnegative(),
  recordedTokens: z.number().int().nonnegative(), recordedCostMicrousd: z.number().int().nonnegative(),
  tokensUnknown: z.boolean(), costUnknown: z.boolean() })
export type SubagentBaselinePlan = z.infer<typeof subagentBaselinePlanSchema>
export const subagentDeadlineRecoverySchema = z.object({ agentId: z.string().uuid(), idempotencyKey: z.string().uuid(),
  expectedDeadline: z.number().int().nonnegative().nullable(), timeoutMs: z.number().int().min(1000).max(86400000),
  note: z.string().trim().min(1).max(4000), confirmRenewal: z.literal(true) }).strict()
export type SubagentDeadlineRecovery = z.infer<typeof subagentDeadlineRecoverySchema>

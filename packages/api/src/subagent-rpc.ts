import { z } from 'zod'
import { actorIdSchema } from './director.ts'
import { subagentMailboxRecoveryMethods } from './subagent-mailbox-recovery.ts'
import { subagentRecoverySchema, subagentPolicyRecoverySchema, subagentModelRecoveryPlanSchema, subagentBaselinePlanSchema, subagentDeadlineRecoverySchema } from './subagent-recovery.ts'
import { subagentRoleDefinitionSchema, subagentRoleInfoSchema } from './subagent-roles.ts'
import { roleImportPreviewSchema, roleImportPlanSchema } from './role-import.ts'
import { jsonValue } from './json.ts'
import { agentReadSchema, agentListSchema, agentMessageRequestSchema, agentSpawnSchema } from './subagents.ts'
export const agentThreadInfoSchema = z.object({
  id: z.string().uuid(), sessionId: z.string().uuid(), childSessionId: z.string().uuid(), parentId: z.string().uuid().nullable(),
  parentActorId: z.string().nullable().optional(),
  agentPath: z.string(), taskName: z.string(), role: z.string(), status: z.string(), result: jsonValue, error: z.string().nullable(),
  createdAt: z.number().int(), updatedAt: z.number().int(), startedAt: z.number().int().nullable(), completedAt: z.number().int().nullable(),
  config: z.object({ depth: z.number().int(), maxTurns: z.number().int(), maxModelRequests: z.number().int(), maxToolCalls: z.number().int(), maxTokens: z.number().int(), maxCostMicrousd: z.number().int().nullable() }), usage: z.object({ turns: z.number().int(), modelRequests: z.number().int(), toolCalls: z.number().int(), tokens: z.number().int(), costMicrousd: z.number().int(), tokensUnknown: z.boolean(), costUnknown: z.boolean() }),
  deadlineAt: z.number().int().nullable(), coordinationBatchId: z.string().nullable(), recoveryState: z.string().nullable(), workspaceRoot: z.string().nullable(),
})
export type AgentThreadInfo = z.infer<typeof agentThreadInfoSchema>
export const subagentRpcMethods = {
  'agent.recovery.mailbox.followup.preview': { params: z.object({ sessionId: z.uuid(), id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    result: z.object({ agentId: z.uuid(), message: z.string() }) },
  'agent.recovery.mailbox.followup.apply': { params: z.object({ sessionId: z.uuid(), id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    note: z.string().trim().min(1).max(4000), confirmExecution: z.literal(true) }).strict(), result: agentThreadInfoSchema },
  'agent.recovery.mailbox.followup.abandon': { params: z.object({ sessionId: z.uuid(), id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    note: z.string().trim().min(1).max(4000), confirmAbandon: z.literal(true) }).strict(), result: z.object({ id: z.uuid(), state: z.literal('archived') }) },
  ...subagentMailboxRecoveryMethods,
  'agent.recovery.read': { params: agentReadSchema, result: subagentRecoverySchema },
  'agent.recovery.reopen': { params: agentReadSchema.extend({ note: z.string().trim().min(1).max(4000), confirmReopen: z.literal(true) }), result: agentThreadInfoSchema },
  'agent.job.resubmit': { params: agentReadSchema.extend({ jobId: z.string().uuid(), expectedUpdatedAt: z.number().int().nonnegative(),
    note: z.string().trim().min(1).max(4000), confirmResubmit: z.literal(true) }), result: agentThreadInfoSchema },
  'agent.recovery.deadline': { params: subagentDeadlineRecoverySchema, result: agentThreadInfoSchema },
  'agent.recovery.usage.preview': { params: agentReadSchema, result: subagentBaselinePlanSchema },
  'agent.recovery.usage.apply': { params: agentReadSchema.extend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    tokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), costMicrousd: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    note: z.string().trim().min(1).max(4000), confirmHistoricalTotal: z.literal(true) }), result: agentThreadInfoSchema },
  'agent.recovery.policy': { params: subagentPolicyRecoverySchema, result: agentThreadInfoSchema },
  'agent.recovery.model.sources': { params: agentReadSchema, result: z.object({ parentSessionId: z.uuid(), actorId: z.string().nullable() }) },
  'agent.recovery.model.preview': { params: agentReadSchema.extend({ actorId: actorIdSchema.optional() }), result: subagentModelRecoveryPlanSchema },
  'agent.recovery.model.apply': { params: agentReadSchema.extend({ actorId: actorIdSchema.optional(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    note: z.string().trim().min(1).max(4000), confirmOwnership: z.literal(true) }), result: agentThreadInfoSchema },
  'agent.workspace.restore': { params: agentReadSchema.extend({ workspaceRoot: z.string().min(1).max(4096), confirmOwnership: z.literal(true) }), result: agentThreadInfoSchema },
  'agent.roles.import.preview': { params: roleImportPreviewSchema, result: roleImportPlanSchema },
  'agent.roles.import.apply': { params: z.object({ previewId: z.string().uuid(), confirmDefinitions: z.literal(true) }).strict(), result: z.object({ previewId: z.string().uuid(), count: z.number().int() }) },
  'agent.requests.list': { params: agentReadSchema.extend({ after: z.string().uuid().optional() }), result: z.object({
    items: z.array(z.object({ id: z.string().uuid(), agentId: z.string().uuid(), turnId: z.string().uuid(), createdAt: z.number().int(), executing: z.boolean(), costConfigured: z.boolean(), tokens: z.number().int().nullable(), costMicrousd: z.number().int().nullable() })),
    nextCursor: z.string().uuid().nullable() }) },
  'agent.requests.review': { params: agentReadSchema.extend({ requestId: z.string().uuid(), tokens: z.number().int().min(0).max(100000000),
    costMicrousd: z.number().int().min(0).max(1000000000), note: z.string().trim().min(1).max(4000), confirmUsage: z.literal(true) }),
    result: z.object({ requestId: z.string().uuid(), state: z.literal('reviewed') }) },
  'agent.roles': { params: z.object({}).strict(), result: z.array(subagentRoleInfoSchema) },
  'agent.roles.remove': { params: z.object({ name: z.string().min(1).max(64), scope: z.enum(['user','project']),
    expectedWorkspaceRoot: z.string().max(4096), expectedRevision: z.string().uuid() }).strict(), result: z.object({ name: z.string(), deleted: z.boolean() }) },
  'agent.roles.edit': { params: z.object({ name: z.string().min(1).max(64), scope: z.enum(['user','project']) }).strict(), result: z.object({
    definition: subagentRoleInfoSchema, scope: z.enum(['user','project']), workspaceRoot: z.string(), expectedRevision: z.string().uuid().nullable() }) },
  'agent.roles.save': { params: z.object({ definition: subagentRoleDefinitionSchema, expectedRevision: z.string().uuid().nullable(),
    scope: z.enum(['user','project']).default('user'), expectedWorkspaceRoot: z.string().max(4096).default('') }).strict(), result: subagentRoleInfoSchema },
  'agent.spawn': { params: agentSpawnSchema, result: agentThreadInfoSchema },
  'agent.list': { params: agentListSchema, result: z.array(agentThreadInfoSchema) },
  'agent.read': { params: agentReadSchema, result: agentThreadInfoSchema },
  'agent.send': { params: agentMessageRequestSchema, result: agentThreadInfoSchema },
  'agent.followup': { params: agentMessageRequestSchema, result: agentThreadInfoSchema },
  'agent.interrupt': { params: agentReadSchema, result: agentThreadInfoSchema },
} as const

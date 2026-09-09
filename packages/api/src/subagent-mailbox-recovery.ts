import { z } from 'zod'
const scope = z.object({ sessionId: z.string().uuid() }).strict()
export const subagentMailboxRecoveryMethods = {
  'agent.recovery.mailbox.list': { params: scope.extend({ after: z.string().uuid().optional() }), result: z.object({
    items: z.array(z.object({ id: z.string().uuid(), senderPath: z.string(), targetPath: z.string(), kind: z.string(),
      state: z.string(), triggerTurn: z.boolean(), content: z.string(), truncated: z.boolean(), fingerprint: z.string(), canDeliver: z.boolean() })),
    nextCursor: z.string().uuid().nullable() }) },
  'agent.recovery.mailbox.resolve': { params: scope.extend({ id: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(['deliver_message', 'archive', 'prepare_followup']), note: z.string().trim().min(1).max(4000), confirmDecision: z.literal(true) }),
    result: z.object({ id: z.string().uuid(), state: z.enum(['available', 'archived', 'followup_prepared']) }) },
} as const

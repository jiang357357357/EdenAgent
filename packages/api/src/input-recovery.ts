import { z } from 'zod'
import { attachmentRefsSchema } from './attachments.ts'
import { jsonValue } from './json.ts'
import { acceptedInputSchema } from './turn-rpc.ts'
const scope = z.object({ sessionId: z.string().uuid() }).strict()
export const inputRecoveryMethods = {
  'input.resubmission.preview': { params: scope.extend({ id: z.string().uuid() }), result: z.object({ fingerprint: z.string(), text: z.string(),
    kind: z.enum(['prompt', 'compact']), attachments: attachmentRefsSchema, environment: jsonValue.optional() }) },
  'input.resubmission.apply': { params: scope.extend({ id: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    note: z.string().trim().min(1).max(4000), confirmResubmit: z.literal(true) }), result: acceptedInputSchema },
  'input.recovery.list': { params: scope.extend({ after: z.string().uuid().optional(), includeCancelled: z.boolean().default(false) }), result: z.object({
    items: z.array(z.object({ id: z.string().uuid(), turnId: z.string().uuid(), state: z.string(), kind: z.string(),
      text: z.string(), truncated: z.boolean(), fingerprint: z.string(), createdAt: z.number().int() })), nextCursor: z.string().uuid().nullable() }) },
  'input.recovery.resolve': { params: scope.extend({ id: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(['completed', 'cancelled']), note: z.string().trim().min(1).max(4000), confirmOutcome: z.literal(true) }),
    result: z.object({ id: z.string().uuid(), state: z.enum(['completed', 'cancelled']) }) },
} as const

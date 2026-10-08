import { z } from 'zod'

const phaseSchema = z.object({
  elapsedMs: z.number().int().nonnegative().safe(),
  activeSince: z.number().int().nonnegative().safe().optional(),
  activeIds: z.array(z.string()),
})

export const replyTimerBreakdownSchema = z.object({
  thinking: phaseSchema,
  tools: phaseSchema,
  turnElapsedMs: z.number().int().nonnegative().safe(),
})

export const replyTimerTurnSchema = z.object({
  turnId: z.string().uuid(),
  startedAt: z.number().int().nonnegative().safe(),
  finishedAt: z.number().int().nonnegative().safe().optional(),
  outcome: z.enum(['running', 'completed', 'interrupted', 'failed']),
})

export const replyTimerSnapshotSchema = z.object({
  turn: replyTimerTurnSchema.nullable(),
  seq: z.string().regex(/^(0|[1-9]\d*)$/),
  observedAt: z.number().int().nonnegative().safe(),
  breakdown: replyTimerBreakdownSchema.optional(),
})

export type ReplyTimerTurn = z.infer<typeof replyTimerTurnSchema>
export type ReplyTimerSnapshot = z.infer<typeof replyTimerSnapshotSchema>
export type ReplyTimerBreakdown = z.infer<typeof replyTimerBreakdownSchema>

import { z } from 'zod'
export const voiceSynthesizeSchema = z.object({
  requestId: z.string().uuid().optional(),
  sessionId: z.string().uuid(), messageId: z.string().min(1).max(256), segmentGroupId: z.string().min(1).max(256),
  groupIndex: z.number().int().nonnegative().max(4294967295), sequence: z.number().int().nonnegative().max(4294967295),
  text: z.string().trim().min(1).max(10000), configId: z.union([z.number().int().safe(), z.string().regex(/^\d{1,20}$/)]),
  mode: z.enum(['text_only', 'all']),
}).strict()
export const voiceSegmentsSchema = z.object({ sessionId: z.string().uuid(), messageId: z.string().min(1).max(256).nullish() }).strict()
export type VoiceSynthesizeInput = z.infer<typeof voiceSynthesizeSchema>

export const voiceCancelSchema = z.object({ sessionId: z.string().uuid(), requestId: z.string().uuid() }).strict()

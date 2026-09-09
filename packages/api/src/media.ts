import { z } from 'zod'
import { jsonValue } from './json.ts'
export const screenRequestSchema = z.object({ source: z.enum(['auto', 'desktop', 'game']).optional(), prompt: z.string().max(2000).optional() }).strict()
export const cameraRequestSchema = z.object({ facingMode: z.enum(['user', 'environment']).optional(), prompt: z.string().max(2000).optional() }).strict()
export const mediaListSchema = z.object({ kind: z.enum(['screen', 'camera']).nullish() }).strict()
export const mediaResultSchema = z.object({ blobId: z.string().uuid(), mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  width: z.number().int().min(1).max(32768), height: z.number().int().min(1).max(32768),
  displayId: z.string().max(256).optional(), sourceName: z.string().max(512).optional(), source: z.enum(['desktop', 'game']).optional(),
  deviceLabel: z.string().max(512).optional(), facingMode: z.string().max(128).optional(),
}).strict()
export const mediaResolveSchema = z.object({ id: z.string().uuid(), result: mediaResultSchema.nullish(), error: z.string().trim().min(1).max(2000).nullish() }).strict()
  .refine(value => Boolean(value.result) !== Boolean(value.error), 'Provide exactly one of result or error')
export const mediaRequestInfoSchema = z.object({ id: z.string().uuid(), sessionId: z.string().uuid(), turnId: z.string().uuid(), kind: z.enum(['screen', 'camera']),
  state: z.enum(['pending', 'resolved', 'rejected', 'cancelled', 'expired']), request: jsonValue, createdAt: z.number().int().nonnegative().safe() })
export type MediaRequestInfo = z.infer<typeof mediaRequestInfoSchema>

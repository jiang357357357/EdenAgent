import { z } from 'zod'
import { jsonValue } from './json.ts'

export const runtimeOriginSchema = z.enum(['mon', 'local'])
export type RuntimeOrigin = z.infer<typeof runtimeOriginSchema>
export const durableEventSchema = z.object({
  id: z.string().uuid(), sessionId: z.string().uuid(), turnId: z.string().uuid().nullable(),
  seq: z.string().regex(/^[1-9]\d*$/), kind: z.string(), payload: jsonValue, createdAt: z.number().int(),
}).strict()
export type DurableEvent = z.infer<typeof durableEventSchema>
export const runtimeCheckpointSchema = z.object({
  format: z.literal('eden.pi-harness.v1'), runtimeVersion: z.literal('0.82.0'),
  sessionId: z.string(), createdAt: z.string(), entries: z.array(jsonValue),
}).strict()
export type RuntimeCheckpoint = z.infer<typeof runtimeCheckpointSchema>

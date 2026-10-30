import { z } from 'zod'

export const desktopControlEventSchema = z.object({
  action: z.enum(['pause', 'resume', 'stop']),
  source: z.enum(['manual', 'physical_input', 'shortcut', 'observer_unavailable', 'watchdog', 'legacy', 'state_corrupt']),
  changedAt: z.number().int().nonnegative(),
  message: z.string().max(500).optional(),
}).strict()
export type DesktopControlEvent = z.infer<typeof desktopControlEventSchema>

export const desktopStatusSchema = z.object({
  available: z.boolean(), busy: z.boolean(), paused: z.boolean(), stopped: z.boolean(),
  observerAvailable: z.boolean(),
  control: desktopControlEventSchema.optional(),
  operations: z.array(z.object({
    sessionId: z.string(), action: z.string(), windowTitle: z.string(),
    state: z.enum(['queued', 'running']), startedAt: z.number(),
  }).strict()),
}).strict()
export type DesktopStatus = z.infer<typeof desktopStatusSchema>
export const desktopControlSchema = z.object({
  action: z.enum(['pause', 'resume', 'stop']),
}).strict()
export const desktopRpcMethods = {
  'desktop.status': { params: z.object({}).strict(), result: desktopStatusSchema },
  'desktop.control': { params: desktopControlSchema, result: desktopStatusSchema },
} as const

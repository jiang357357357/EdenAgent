import { z } from 'zod'

export const hookPayload = z.object({
  pluginId: z.string().min(1), revision: z.string().min(1), hookId: z.string().min(1),
  skillName: z.string().min(1), eventId: z.string().min(1), event: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
}).strict()

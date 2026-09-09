import { z } from 'zod'
import { jsonValue } from './json.ts'
export const desktopReminderCreateSchema = z.object({ title: z.string().trim().min(1).max(1000), message: z.string().trim().min(1).max(16000) }).strict()
export const desktopReminderIdSchema = z.object({ id: z.uuid() }).strict()
export const desktopReminderListSchema = z.object({ limit: z.number().int().min(1).max(100).default(20), includeClosed: z.boolean().default(false) }).strict()
export const desktopReminderSchema = desktopReminderCreateSchema.extend({ id: z.uuid(), sessionId: z.uuid(), turnId: z.uuid().nullable(),
  state: z.enum(['pending', 'displayed', 'closed', 'failed', 'unknown']), author: jsonValue, createdAt: z.number().int(), displayedAt: z.number().int().nullable(), closedAt: z.number().int().nullable() })
export type DesktopReminder = z.infer<typeof desktopReminderSchema>

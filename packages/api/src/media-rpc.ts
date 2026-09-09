import { z } from 'zod'
import { mediaListSchema, mediaResolveSchema, mediaRequestInfoSchema } from './media.ts'
import { desktopReminderListSchema, desktopReminderIdSchema, desktopReminderSchema } from './notifications.ts'
export const mediaRpcMethods = {
  'media.list': { params: mediaListSchema, result: z.array(mediaRequestInfoSchema) },
  'media.resolve': { params: mediaResolveSchema, result: mediaRequestInfoSchema },
  'desktop.reminder.list': { params: desktopReminderListSchema, result: z.array(desktopReminderSchema) },
  'desktop.reminder.displayed': { params: desktopReminderIdSchema, result: desktopReminderSchema },
  'desktop.reminder.close': { params: desktopReminderIdSchema, result: desktopReminderSchema },
} as const

import { z } from 'zod'
import { desktopReminderCreateSchema, desktopReminderIdSchema, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { RuntimeTool } from '@eden/runtime-pi'
import type { PermissionService } from '../permissions/index.ts'
import type { DesktopReminderRepository } from './repository.ts'

export function desktopReminderTools(repository: DesktopReminderRepository, permissions: PermissionService, sessionId: string, turnId: string): RuntimeTool[] {
  return [{ name: 'show_desktop_reminder', revision: 'eden.desktop-reminder.v1', executionMode: 'sequential',
    description: 'Queue a persistent message for the user in the current world after approval. Pending means queued, displayed means a client rendered it, and closed means the user dismissed it.',
    parameters: toJson(z.toJSONSchema(desktopReminderCreateSchema)) as Record<string, JsonValue>,
    async execute(raw, context) {
      const input = desktopReminderCreateSchema.parse(raw)
      await permissions.request({ ...context, sessionId, turnId }, 'desktop.notify', sessionId, toJson(input))
      context.signal.throwIfAborted()
      return toJson(repository.create(sessionId, turnId, input, `tool:${sessionId}:${turnId}:${context.callId}`))
    },
  }, { name: 'get_desktop_reminder', revision: 'eden.desktop-reminder.v1', executionMode: 'sequential',
    description: 'Read delivery and dismissal status of a desktop reminder from this session.',
    parameters: toJson(z.toJSONSchema(desktopReminderIdSchema)) as Record<string, JsonValue>,
    async execute(raw, context) {
      context.signal.throwIfAborted()
      const reminder = repository.read(desktopReminderIdSchema.parse(raw).id)
      if (reminder.sessionId !== sessionId) throw new Error('Reminder belongs to a different session')
      return toJson(reminder)
    },
  }]
}

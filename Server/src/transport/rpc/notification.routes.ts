import { rpcMethods, type JsonValue } from '@eden/api'
import type { DesktopReminderRepository } from '../../modules/notifications/index.ts'
import { contractHandler } from './contract-handler.ts'
export function notificationRoutes(repository: DesktopReminderRepository): Record<string, (params: JsonValue) => Promise<JsonValue>> {
  return {
    'desktop.reminder.list': contractHandler(rpcMethods['desktop.reminder.list'], input => repository.list(input)),
    'desktop.reminder.displayed': contractHandler(rpcMethods['desktop.reminder.displayed'], input => repository.transition(input.id, 'displayed')),
    'desktop.reminder.close': contractHandler(rpcMethods['desktop.reminder.close'], input => repository.transition(input.id, 'closed')),
  }
}

import { z } from 'zod'
const preferences = z.object({ autoScrollEnabled: z.boolean() }).strict()
export const uiPreferenceRpcMethods = {
  'ui.preferences.get': { params: z.object({}).strict(), result: preferences },
  'ui.preferences.update': { params: preferences, result: preferences },
} as const

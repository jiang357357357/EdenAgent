import { z } from 'zod'

export const permissionModeSchema = z.enum(['restricted', 'full_access', 'takeover'])
export const permissionModeInfoSchema = z.object({ mode: permissionModeSchema }).strict()
export type PermissionMode = z.infer<typeof permissionModeSchema>

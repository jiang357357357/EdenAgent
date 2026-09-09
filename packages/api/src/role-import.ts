import { z } from 'zod'
import { subagentRoleDefinitionSchema } from './subagent-roles.ts'
export const roleImportEntrySchema = z.object({ scope: z.enum(['user','project']), source: z.string().min(1).max(4096),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), originalToml: z.string().max(262144), definition: subagentRoleDefinitionSchema,
  issues: z.array(z.string()).max(0), state: z.literal('review_required') }).strict()
export const roleImportPreviewSchema = z.object({ entries: z.array(roleImportEntrySchema).min(1).max(32) }).strict()
export const roleImportPlanSchema = z.object({ previewId: z.string().uuid(), expiresAt: z.number().int(), items: z.array(z.object({
  name: z.string(), scope: z.enum(['user','project']), workspaceRoot: z.string(), replaces: z.boolean(), source: z.string(), sha256: z.string(), definition: subagentRoleDefinitionSchema })) })
export type RoleImportEntry = z.infer<typeof roleImportEntrySchema>

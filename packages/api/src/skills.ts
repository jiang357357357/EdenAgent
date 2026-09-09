import { z } from 'zod'
export const skillNameSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/)
export const skillReadSchema = z.object({ name: skillNameSchema, expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), expectedWorkspaceRoot: z.string().max(4096).optional() }).strict()
export const skillEnableSchema = skillReadSchema.extend({ enabled: z.boolean() })
export const skillInspectSchema = z.object({ sourceType: z.enum(['local', 'git']), sourceUri: z.string().min(1).max(4096),
  sourceRef: z.string().max(256).nullable().optional(), sourceSubpath: z.string().max(1024).nullable().optional(), scope: z.enum(['user', 'project']) }).strict()
export const skillPreviewInstallSchema = z.object({ previewId: z.uuid() }).strict()
export const skillFileSchema = skillReadSchema.extend({ path: z.string().min(1).max(1024) })
export const skillCreateSchema = z.object({ name: skillNameSchema, description: z.string().max(4000), content: z.string().min(1).max(262144) }).strict()

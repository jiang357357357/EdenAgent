import { z } from 'zod'
import { jsonValue } from './json.ts'
import { skillReadSchema, skillEnableSchema, skillInspectSchema, skillPreviewInstallSchema, skillFileSchema, skillCreateSchema } from './skills.ts'
const source = z.object({ type: z.string(), uri: z.string(), ref: z.string(), subpath: z.string() })
const codeTool = z.object({ name: z.string(), label: z.string(), description: z.string(), parameters: z.record(z.string(), jsonValue),
  outputSchema: z.record(z.string(), jsonValue).optional(), command: z.array(z.string()), testCommand: z.array(z.string()), timeoutSeconds: z.number().int() })
export const skillInfoSchema = z.object({
  name: z.string(), displayName: z.string(), description: z.string(), version: z.string(), content: z.string().nullable(),
  modelInvocable: z.boolean(), tools: z.array(z.string()), profiles: z.array(z.string()), permissions: z.array(z.string()), defaultPrompt: z.string(),
  codeTools: z.array(codeTool).optional(), files: z.array(z.string()), contentHash: z.string().regex(/^[a-f0-9]{64}$/), totalBytes: z.number().int().nonnegative(),
  enabled: z.boolean(), available: z.boolean(), missingTools: z.array(z.string()), scope: z.string(), workspaceRoot: z.string(), sourceType: z.string(),
  manifest: z.object({ source, discovered: z.boolean().optional(), workspaceRoot: z.string() }),
})
export const skillPreviewInfoSchema = skillInfoSchema.pick({ displayName: true, description: true, version: true, scope: true,
  workspaceRoot: true, tools: true, profiles: true, modelInvocable: true, contentHash: true, totalBytes: true }).extend({
  previewID: z.string().uuid(), skillName: z.string(), source, fileCount: z.number().int(), expiresAt: z.number().int(),
})
export type SkillInfo = z.infer<typeof skillInfoSchema>
export const skillRpcMethods = {
  'skill.catalog_status': { params: z.object({}).strict(), result: z.object({ error: z.string().nullable(), refreshing: z.boolean(), codeToolsAvailable: z.boolean() }) },
  'skill.refresh': { params: z.object({}).strict(), result: z.object({ refreshed: z.literal(true) }) },
  'skill.list': { params: z.object({}).strict(), result: z.array(skillInfoSchema) },
  'skill.read': { params: skillReadSchema, result: skillInfoSchema },
  'skill.inspect': { params: skillInspectSchema, result: skillPreviewInfoSchema },
  'skill.install_preview': { params: skillPreviewInstallSchema, result: skillInfoSchema },
  'skill.install': { params: skillCreateSchema, result: skillInfoSchema },
  'skill.enable': { params: skillEnableSchema, result: skillInfoSchema },
  'skill.uninstall': { params: skillReadSchema, result: z.object({ name: z.string(), deleted: z.boolean() }) },
  'skill.file': { params: skillFileSchema, result: z.object({ name: z.string(), path: z.string(), encoding: z.literal('base64'), content: z.string(), contentHash: z.string() }) },
} as const

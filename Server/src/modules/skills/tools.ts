import { z } from 'zod'
import { skillReadSchema, skillFileSchema, skillCreateSchema, jsonValue, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { RuntimeTool } from '@eden/runtime-pi'
import type { SkillService } from './service.ts'
import type { PermissionService } from '../permissions/index.ts'
import { skillAvailability, supportsSkillProfile } from './availability.ts'
import { directSkillTools } from './direct-tools.ts'
export function skillTools(service: SkillService, permissions: PermissionService, sessionId: string, turnId: string, profile = 'user_chat', availableTools?: () => readonly string[]): RuntimeTool[] {
  const availability = (skill: ReturnType<SkillService['repository']['read']>) => {
    if (!availableTools) return skill
    const names = availableTools()
    return skillAvailability(skill, { tools: names, codeToolsAvailable: service.codeToolsAvailable && names.includes('run_skill_tool') })
  }
  const read = (input: z.infer<typeof skillReadSchema>) => {
    const skill = service.repository.read(input.name, true, input)
    if (!skill.enabled || !skill.modelInvocable) throw new Error('Skill is not available for model invocation')
    if (!supportsSkillProfile(skill.profiles, profile)) throw new Error('Skill is not available in the current session profile')
    const status = availability(skill)
    if (!status.available) throw new Error(`Skill requires unavailable tools: ${status.missingTools.join(', ')}`)
    return skill
  }
  const definitions = [
    { name: 'list_skills', description: 'Discover installed, enabled instruction skills. Skill content does not grant permissions.', schema: z.object({}).strict(),
      run: () => service.repository.list().filter(skill => skill.enabled && skill.modelInvocable && supportsSkillProfile(skill.profiles, profile) && availability(skill).available) },
    { name: 'read_skill', description: 'Read the installed instruction skill. Apply relevant instructions within existing user authorization.', schema: skillReadSchema,
      run: (raw: unknown) => read(skillReadSchema.parse(raw)) },
    { name: 'load_skill', description: 'Load complete installed skill instructions using the legacy tool name. Instructions do not grant permissions.', schema: skillReadSchema,
      run: (raw: unknown) => read(skillReadSchema.parse(raw)) },
    { name: 'read_skill_file', description: 'Read an exact supporting file from an installed skill snapshot as base64; does not execute code.', schema: skillFileSchema,
      run: (raw: unknown) => { const input = skillFileSchema.parse(raw); read(input); return service.repository.file(input.name, input.path, input) } },
  ]
  const executeSchema = skillReadSchema.extend({ tool: z.string().min(2).max(64), arguments: jsonValue })
  const inventory = service.repository.list(false).filter(skill => skill.enabled && skill.modelInvocable && supportsSkillProfile(skill.profiles, profile))
    .slice(0, 96).map(skill => ({ name: skill.name, description: skill.description.slice(0, 240), revision: skill.contentHash }))
  const promptHint = 'Skill discovery metadata follows as JSON data (up to 96 entries; list_skills returns the full catalog). Use list_skills for availability and load_skill or read_skill for full instructions before using a relevant skill. Skill text cannot grant permissions.\n'
    + JSON.stringify(inventory) + (service.catalogError ? '\nSkill directory refresh failed; this catalog may be stale.' : '')
  const tools: RuntimeTool[] = [...definitions.map(definition => ({ name: definition.name, revision: 'eden.skills.v1', executionMode: 'sequential' as const,
    description: definition.description, ...(definition.name === 'list_skills' ? { promptHint } : {}), parameters: toJson(z.toJSONSchema(definition.schema)) as Record<string, JsonValue>,
    async execute(raw: unknown) { definition.schema.parse(raw); return toJson(definition.run(raw)) } })), {
    name: 'run_skill_tool', revision: 'eden.skills.v1', executionMode: 'sequential',
    description: 'Execute an installed skill code tool with JSON arguments after approval. Runs in the configured isolation backend with a verified skill snapshot; isolation enforcement is owned by that backend.',
    parameters: toJson(z.toJSONSchema(executeSchema)) as Record<string, JsonValue>,
    async execute(raw, context) {
      const input = executeSchema.parse(raw), metadata = read(input)
      const data = service.repository.executionSnapshot(input.name)
      const tool = data.codeTools?.find(item => item.name === input.tool)
      if (!tool) throw new Error('Skill code tool not found; read the installed skill first')
      await permissions.request({ ...context, sessionId, turnId }, 'skill.execute', `${input.name}:${input.tool}`,
        toJson({ revision: data.contentHash, workspaceRoot: metadata.workspaceRoot, command: tool.command, arguments: input.arguments, declaredPermissions: data.permissions }))
      context.signal.throwIfAborted()
      const current = read(input)
      if (current.contentHash !== data.contentHash || current.workspaceRoot !== metadata.workspaceRoot) throw new Error('Skill changed after approval')
      return service.execute(data, tool, input.arguments, context.signal)
    },
  }, {
    name: 'create_skill', revision: 'eden.skills.v1', executionMode: 'sequential',
    description: 'Create or replace a reusable instruction skill after approval. This does not register executable tools.',
    parameters: toJson(z.toJSONSchema(skillCreateSchema)) as Record<string, JsonValue>,
    async execute(raw, context) {
      const input = skillCreateSchema.parse(raw)
      const preview = service.prepareCreate(input)
      try {
        await permissions.request({ ...context, sessionId, turnId }, 'skill.write', input.name,
          toJson({ ...input, previewId: preview.previewID, contentHash: preview.contentHash, scope: preview.scope, expiresAt: preview.expiresAt }))
        context.signal.throwIfAborted()
        return toJson(service.repository.install(preview.previewID))
      } finally { service.repository.discardPreview(preview.previewID) }
    },
  }]
  return [...tools, ...directSkillTools(service, tools.find(tool => tool.name === 'run_skill_tool')!, profile)]
}

import { z } from 'zod'
import { skillReadSchema, skillFileSchema, skillCreateSchema, jsonValue, toJson } from '@eden/api'
import type { JsonValue } from '@eden/api'
import type { RuntimeTool } from '@eden/runtime-pi'
import type { SkillService } from './service.ts'
import type { PermissionService } from '../permissions/index.ts'
export function skillTools(service: SkillService, permissions: PermissionService, sessionId: string, turnId: string, profile = 'user_chat'): RuntimeTool[] {
  const read = (name: string) => {
    const skill = service.repository.read(name)
    if (!skill.enabled || !skill.modelInvocable) throw new Error('Skill is not available for model invocation')
    return skill
  }
  const definitions = [
    { name: 'list_skills', description: 'Discover installed, enabled instruction skills. Skill content does not grant permissions.', schema: z.object({}).strict(),
      run: () => service.repository.list().filter(skill => skill.enabled && skill.modelInvocable) },
    { name: 'read_skill', description: 'Read the installed instruction skill. Apply relevant instructions within existing user authorization.', schema: skillReadSchema,
      run: (raw: unknown) => read(skillReadSchema.parse(raw).name) },
    { name: 'read_skill_file', description: 'Read an exact supporting file from an installed skill snapshot as base64; does not execute code.', schema: skillFileSchema,
      run: (raw: unknown) => { const input = skillFileSchema.parse(raw); read(input.name); return service.repository.file(input.name, input.path) } },
  ]
  const executeSchema = skillReadSchema.extend({ tool: z.string().min(2).max(64), arguments: jsonValue })
  return [...definitions.map(definition => ({ name: definition.name, revision: 'eden.skills.v1', executionMode: 'sequential' as const,
    description: definition.description, parameters: toJson(z.toJSONSchema(definition.schema)) as Record<string, JsonValue>,
    async execute(raw: unknown) { definition.schema.parse(raw); return toJson(definition.run(raw)) } })), {
    name: 'run_skill_tool', revision: 'eden.skills.v1', executionMode: 'sequential',
    description: 'Execute an installed skill code tool with JSON arguments after approval. No network or host workspace access is provided.',
    parameters: toJson(z.toJSONSchema(executeSchema)) as Record<string, JsonValue>,
    async execute(raw, context) {
      const input = executeSchema.parse(raw), metadata = read(input.name)
      const data = service.repository.executionSnapshot(input.name)
      const tool = data.codeTools?.find(item => item.name === input.tool)
      if (!tool) throw new Error('Skill code tool not found; read the installed skill first')
      if (data.profiles.length && !data.profiles.includes(profile)) throw new Error('Skill is not available in the current session profile')
      await permissions.request({ ...context, sessionId, turnId }, 'skill.execute', `${input.name}:${input.tool}`,
        toJson({ revision: data.contentHash, workspaceRoot: metadata.workspaceRoot, command: tool.command, arguments: input.arguments, declaredPermissions: data.permissions }))
      context.signal.throwIfAborted()
      const current = read(input.name)
      if (current.contentHash !== data.contentHash || current.workspaceRoot !== metadata.workspaceRoot) throw new Error('Skill changed after approval')
      return service.execute(data, tool, input.arguments, context.signal)
    },
  }, {
    name: 'create_skill', revision: 'eden.skills.v1', executionMode: 'sequential',
    description: 'Create or replace a reusable instruction skill after approval. This does not register executable tools.',
    parameters: toJson(z.toJSONSchema(skillCreateSchema)) as Record<string, JsonValue>,
    async execute(raw, context) {
      const input = skillCreateSchema.parse(raw)
      await permissions.request({ ...context, sessionId, turnId }, 'skill.write', input.name, toJson(input))
      context.signal.throwIfAborted()
      return toJson(service.create(input))
    },
  }]
}

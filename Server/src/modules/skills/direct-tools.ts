import type { RuntimeTool } from '@eden/runtime-pi'
import type { SkillService } from './service.ts'
import { supportsSkillProfile } from './availability.ts'

export function directSkillTools(service: SkillService, executor: RuntimeTool, profile: string): RuntimeTool[] {
  if (!service.codeToolsAvailable) return []
  // Do not evaluate capabilities here: constructing the host catalog must not recursively construct itself.
  return service.repository.list(false).filter(skill => skill.enabled && skill.modelInvocable && supportsSkillProfile(skill.profiles, profile))
    .flatMap(skill => (skill.codeTools ?? []).map((tool): RuntimeTool => ({
      name: tool.name, description: tool.description, parameters: tool.parameters,
      revision: `skill:${skill.name}:${skill.contentHash}`, executionMode: 'sequential' as const,
      execute(raw, context) {
        return executor.execute({ name: skill.name, tool: tool.name, arguments: raw,
          expectedContentHash: skill.contentHash, expectedWorkspaceRoot: skill.workspaceRoot }, context)
      },
    })))
}

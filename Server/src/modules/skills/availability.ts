import type { SkillSnapshot } from './snapshot.ts'

export interface SkillCapabilities { tools: readonly string[]; codeToolsAvailable: boolean }

export function skillAvailability(skill: Pick<SkillSnapshot, 'tools' | 'codeTools'>, capabilities: SkillCapabilities) {
  const known = new Set(capabilities.tools)
  if (capabilities.codeToolsAvailable) for (const tool of skill.codeTools ?? []) known.add(tool.name)
  const missingTools = skill.tools.filter(name => !known.has(name))
  return { available: missingTools.length === 0, missingTools }
}

export function supportsSkillProfile(profiles: readonly string[], profile: string) {
  return (profiles.length ? profiles : ['user_chat', 'self_awake']).includes(profile)
}

import type { RoleSkillSnapshot } from './role-skills.ts'
import type { SubagentPolicy } from './tool-policy.ts'

/** Skill requirements must fit the effective child policy; skill text never widens it. */
export function assertRoleSkillPolicy(skills: readonly RoleSkillSnapshot[], policy: SubagentPolicy) {
  const permits = (name: string) => !policy.deniedTools.includes(name)
    && (policy.allowedTools === null || policy.allowedTools.includes(name))
  for (const skill of skills) {
    if (!skill.toolDependencies) throw new Error(`Recapture role skill dependencies before saving the policy: ${skill.name}`)
    const missing = skill.toolDependencies.filter(dependency => !dependency.alternatives.some(permits))
    if (missing.length) throw new Error(`Role skill ${skill.name} requires tools excluded by the child policy: ${missing.map(item => item.name).join(', ')}`)
  }
}

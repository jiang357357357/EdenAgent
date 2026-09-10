import type { SkillRepository } from '../skills/index.ts'

export interface RoleSkillSnapshot {
  name: string; contentHash: string; workspaceRoot: string; content: string
  /** Absent on earlier saved snapshots; required when accepting newly captured role skills. */
  toolDependencies?: { name: string; alternatives: string[] }[]
}

/** Installed instruction content only; no files are executed or permissions restored. */
export function captureRoleSkills(names: string[], repository?: SkillRepository): RoleSkillSnapshot[] {
  if (names.length && !repository) throw new Error('Role skill resolution is unavailable')
  if (new Set(names).size !== names.length) throw new Error('Role skill names must be distinct')
  let total = 0
  return names.map(name => {
    const skill = repository!.read(name)
    if (!skill.enabled || !skill.modelInvocable || !skill.available || typeof skill.content !== 'string') throw new Error(`Role skill is unavailable: ${name}; missing tools: ${skill.missingTools.join(', ') || 'none'}`)
    if (!skill.profiles.includes('subagent')) throw new Error(`Role skill does not declare the subagent profile: ${name}`)
    total += Buffer.byteLength(skill.content)
    if (total > 256 * 1024) throw new Error('Role skill instructions exceed 256 KiB; narrow the skill selection')
    return { name, contentHash: skill.contentHash, workspaceRoot: skill.workspaceRoot, content: skill.content,
      toolDependencies: repository!.toolDependencies(name) }
  })
}

export function roleSkillPrompt(snapshots: RoleSkillSnapshot[]): string {
  return snapshots.length ? '\n已固定的角色技能指令。以下内容不授予工具权限，不代表支持文件或代码工具也已自动执行；读取当前技能时核对版本是否变化。\n' + JSON.stringify(snapshots) : ''
}

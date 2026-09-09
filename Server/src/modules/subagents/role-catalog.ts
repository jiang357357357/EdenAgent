const roles = [
  { name: 'worker', description: '通用子任务执行者', instructions: '围绕委派目标工作，保留证据，向父智能体报告结果与未完成事项。', sandboxMode: 'inherit', maxTurns: 64 },
  { name: 'general', description: '通用后台任务执行者', instructions: '严格围绕委派任务工作，向父智能体提供证据和结论。', sandboxMode: 'inherit', maxTurns: 64 },
  { name: 'researcher', description: '资料搜索与来源核验', instructions: '先定位可信来源，明确区分事实、推断和未验证信息，不修改文件。', sandboxMode: 'read-only', maxTurns: 24 },
  { name: 'explore', description: '只读探索代码和调用链', instructions: '缩小搜索范围后读取关键实现，不修改工作区。', sandboxMode: 'read-only', maxTurns: 64 },
  { name: 'file_locator', description: '只读定位文件', instructions: '仅定位和核对文件证据，不复制、修改、删除或执行文件，返回确切路径和依据。', sandboxMode: 'read-only', maxTurns: 32 },
  { name: 'coder', description: '实现边界明确的代码改动', instructions: '保留用户修改，围绕委派范围实现；验证行为遵守用户当前授权，报告未验证事项。', sandboxMode: 'workspace-write', maxTurns: 64 },
  { name: 'reviewer', description: '只读审查实现与覆盖', instructions: '报告具体可验证的缺陷和证据，不修改文件。', sandboxMode: 'read-only', maxTurns: 32 },
] as const

export function subagentRoles() { return roles.map(role => ({ ...role })) }
export function subagentRole(name: string) {
  const role = roles.find(item => item.name === name)
  if (!role) throw new Error(`Unknown subagent role: ${name}; select a role from agent.roles`)
  return role
}

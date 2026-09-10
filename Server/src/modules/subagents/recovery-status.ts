import { createHash } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import type { SubagentRecovery } from '@eden/api'
import { WorkspaceRepository } from '../workspace/index.ts'

/** Expose recovery facts, never the historical configuration that may contain credentials. */
export function subagentRecoveryStatus(database: EdenDatabase, agentId: string): SubagentRecovery {
  const db = database.connection
  const thread = db.prepare('SELECT * FROM subagent_threads WHERE id=?').get(agentId)
  if (!thread) throw new Error('Subagent not found')
  const child = String(thread.child_session_id)
  const session = db.prepare('SELECT status FROM sessions WHERE id=?').get(child)
  if (!session) throw new Error('Subagent session is missing')
  const historical = db.prepare('SELECT state,config_json FROM legacy_subagent_context WHERE agent_id=?').get(agentId)
  const context = db.prepare('SELECT state FROM legacy_runtime_contexts WHERE session_id=?').get(child)
  const checkpoint = db.prepare('SELECT 1 FROM runtime_checkpoints WHERE session_id=?').get(child)
  const policy = db.prepare('SELECT 1 FROM subagent_policies WHERE agent_id=?').get(agentId)
  const role = db.prepare('SELECT 1 FROM subagent_role_snapshots WHERE agent_id=?').get(agentId)
  const modelReview = db.prepare('SELECT 1 FROM subagent_model_restorations WHERE agent_id=?').get(agentId)
  const parent = thread.parent_id == null ? undefined : db.prepare(`SELECT t.workspace_root,c.state AS recovery_state
    FROM subagent_threads t LEFT JOIN legacy_subagent_context c ON c.agent_id=t.id WHERE t.id=?`).get(thread.parent_id)
  const unresolvedRequests = db.prepare(`SELECT 1 FROM subagent_request_owners o
    JOIN subagent_model_requests r ON r.id=o.request_id WHERE o.agent_id=? AND r.state='pending' LIMIT 1`).get(agentId)
  const pendingInput = db.prepare("SELECT 1 FROM inputs WHERE session_id=? AND state IN ('queued','running','held','interrupted') LIMIT 1").get(child)
  const activeJob = db.prepare("SELECT 1 FROM jobs WHERE session_id=? AND state IN ('queued','running','unknown') LIMIT 1").get(child)
  const root = thread.workspace_root == null ? null : String(thread.workspace_root)
  const check = (key: string, satisfied: boolean, detail: string) => ({ key, satisfied, detail })
  return {
    agentId, childSessionId: child, legacyState: historical ? String(historical.state) : null,
    sessionStatus: String(session.status), workspaceRoot: root,
    historicalConfigurationHash: historical ? createHash('sha256').update(String(historical.config_json)).digest('hex') : null,
    checks: [
      check('inactive', !['queued', 'running'].includes(String(thread.state)), '任务须停止后才能恢复配置。'),
      check('context', contextRecovered(checkpoint, historical, context), '历史上下文须已转换或明确应用人工摘要。'),
      check('workspace', Boolean(root) && root === new WorkspaceRepository(database).read(), '须明确绑定并选择原任务工作区。'),
      check('parent', parentRecovered(thread.parent_id, parent, root), '嵌套任务须先恢复父任务与工作区归属。'),
      check('policy', Boolean(policy && role), '须保存经过历史限制收窄的工具策略及角色技能快照。'),
      check('modelReview', !historical || Boolean(modelReview), '须明确确认恢复模型；待激活快照不代表已经绑定到运行会话。'),
      check('usage', !thread.usage_unknown && !thread.cost_unknown && !unresolvedRequests, '历史用量与未确认模型请求须先核对。'),
      check('pendingWork', !pendingInput && !activeJob, '旧输入和作业须明确处理，恢复配置不会自动重发。'),
      check('deadline', thread.deadline_at == null || Number(thread.deadline_at) > Date.now(), '已过期任务不能直接续接，截止期限须有明确处理。'),
      check('legacyReady', !historical || historical.state === 'ready', '各项准备不等于激活；旧任务须完成整体恢复记录。'),
    ],
  }
}

function parentRecovered(parentId: unknown, parent: Record<string, unknown> | undefined, root: string | null) { return parentId == null || Boolean(parent && parent.workspace_root === root && (parent.recovery_state == null || parent.recovery_state === 'ready')) }

function contextRecovered(checkpoint: unknown, historical: unknown, context: Record<string, unknown> | undefined) {
  return Boolean(checkpoint) && (!historical || context?.state === 'prepared')
}

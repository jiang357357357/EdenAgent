import { createHash } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import type { SubagentPolicyRecovery } from '@eden/api'
import type { SubagentRoleRepository } from './role-repository.ts'
import type { RoleSkillSnapshot } from './role-skills.ts'
import { assertSubagentWorkspace } from './workspace-owner.ts'
import { narrowPolicy, rolePolicy, subagentPolicy } from './tool-policy.ts'
import { assertRoleSkillPolicy } from './role-skill-policy.ts'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** Saves explicitly reviewed mappings; it never infers that unknown old tools were harmless. */
export function restoreSubagentPolicy(database: EdenDatabase, roles: SubagentRoleRepository,
  input: SubagentPolicyRecovery, skills: RoleSkillSnapshot[]) {
  database.transaction(() => {
    const db = database.connection, requestHash = hash(JSON.stringify(input))
    const previous = db.prepare('SELECT request_hash FROM subagent_policy_restorations WHERE agent_id=?').get(input.agentId)
    if (previous) {
      if (previous.request_hash !== requestHash) throw new Error('Policy recovery was already recorded with different decisions')
      return
    }
    const thread = db.prepare('SELECT * FROM subagent_threads WHERE id=?').get(input.agentId)
    const legacy = db.prepare('SELECT state,config_json FROM legacy_subagent_context WHERE agent_id=?').get(input.agentId)
    if (!thread || !legacy || legacy.state !== 'context_prepared_policy_required') throw new Error('Restore the historical context before reviewing its policy')
    if (hash(String(legacy.config_json)) !== input.sourceHash) throw new Error('Historical configuration changed; review it again')
    if (['queued', 'running'].includes(String(thread.state))) throw new Error('Stop the task before restoring its policy')
    if (db.prepare("SELECT 1 FROM inputs WHERE session_id=? AND state='running' LIMIT 1").get(thread.child_session_id!)) throw new Error('Child session still has an executing input')
    assertSubagentWorkspace(database, String(thread.child_session_id))
    if (thread.workspace_root !== input.workspaceRoot) throw new Error('Workspace ownership changed; reload the recovery form')
    const definition = roles.read(input.role)
    if (definition.revision !== input.expectedRoleRevision) throw new Error('Role definition changed; review it again')
    if (JSON.stringify(definition.skills) !== JSON.stringify(skills.map(skill => skill.name))) throw new Error('Role skill selection changed')
    const requested = rolePolicy(input.role, definition)
    let policy = narrowPolicy({ ...input.historicalPolicy, instructions: definition.instructions }, requested)
    // Re-normalize read-only restrictions even when only the historical policy specified them.
    policy = rolePolicy(input.role, { ...definition, ...policy })
    const parent = subagentPolicy(database, String(thread.parent_session_id))
    if (parent) policy = narrowPolicy(parent, policy)
    assertRoleSkillPolicy(skills, policy)
    if (db.prepare('SELECT 1 FROM subagent_policies WHERE agent_id=?').get(input.agentId)) throw new Error('Task already has a policy snapshot')
    const now = Date.now()
    db.prepare('INSERT INTO subagent_policies VALUES(?,?,?)').run(input.agentId, JSON.stringify(policy), now)
    db.prepare('INSERT INTO subagent_role_snapshots VALUES(?,?,?,?)').run(input.agentId, JSON.stringify(definition), JSON.stringify(skills), now)
    db.prepare('INSERT INTO subagent_policy_restorations VALUES(?,?,?,?,?,?)')
      .run(input.agentId, input.sourceHash, requestHash, JSON.stringify(input), JSON.stringify(policy), now)
    db.prepare(`UPDATE subagent_threads SET role=?,max_turns=MIN(max_turns,?),max_model_requests=MIN(max_model_requests,?),
      max_tool_calls=MIN(max_tool_calls,?),max_tokens=MIN(max_tokens,?),
      max_cost_microusd=CASE WHEN ? IS NULL THEN max_cost_microusd WHEN max_cost_microusd IS NULL THEN ? ELSE MIN(max_cost_microusd,?) END,
      deadline_at=MIN(COALESCE(deadline_at,?),?),updated_at=? WHERE id=?`).run(input.role, definition.maxTurns, definition.maxModelRequests, definition.maxToolCalls,
        definition.maxTokens, definition.maxCostMicrousd, definition.maxCostMicrousd, definition.maxCostMicrousd,
        now + definition.timeoutMs, now + definition.timeoutMs, now, input.agentId)
    db.prepare("UPDATE legacy_subagent_context SET state='policy_prepared_model_required' WHERE agent_id=?").run(input.agentId)
  })
}

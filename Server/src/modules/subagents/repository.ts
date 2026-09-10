import { settleSubagentThreads } from './settlement.ts'
import { subagentRecoveryStatus } from './recovery-status.ts'
import { restoreSubagentPolicy } from './policy-recovery.ts'
import { SubagentModelRecovery } from './model-recovery.ts'
import { SubagentBaselineRecovery } from './baseline-recovery.ts'
import { reopenHistoricalSubagent } from './reopen-recovery.ts'
import { renewHistoricalDeadline } from './deadline-recovery.ts'
import { SubagentMailboxRecovery } from './mailbox-recovery.ts'
import { SubagentJobResubmission } from './job-resubmission.ts'
import type { SubagentDeadlineRecovery } from '@eden/api'
import type { ModelService } from '../models/index.ts'
import type { SubagentPolicyRecovery } from '@eden/api'
import { spawnRequestHash } from './spawn-identity.ts'
import { randomUUID } from 'node:crypto'
import { rolePolicy, narrowPolicy, subagentPolicy } from './tool-policy.ts'
import { SubagentRoleRepository } from './role-repository.ts'
import { SubagentRoleImport } from './role-import.ts'
import { restoreSubagentWorkspace, assertSubagentWorkspace } from './workspace-owner.ts'
import { roleSkillPrompt } from './role-skills.ts'
import { assertRoleSkillPolicy } from './role-skill-policy.ts'
import type { RoleSkillSnapshot } from './role-skills.ts'
import { SubagentRequestReview } from './request-review.ts'
import { assertSettledSubagentRequests } from './request-repository.ts'
import type { EdenDatabase } from '@eden/store'
import type { JobRepository } from '../jobs/index.ts'
export class SubagentRepository {
  constructor(private readonly database: EdenDatabase, private readonly jobs: JobRepository, private readonly workspace: () => string = () => '') { }
  policy(sessionId: string) { return subagentPolicy(this.database, sessionId) }
  recoveryStatus(id: string) { return subagentRecoveryStatus(this.database, id) }
  modelRecovery(models: ModelService) { return new SubagentModelRecovery(this.database, models) }
  baselineRecovery() { return new SubagentBaselineRecovery(this.database) }
  mailboxRecovery() { return new SubagentMailboxRecovery(this.database) }
  jobResubmission() { return new SubagentJobResubmission(this.database, this.jobs) }
  renewDeadline(input: SubagentDeadlineRecovery) { renewHistoricalDeadline(this.database, input); return this.read(input.agentId) }
  reopenHistorical(models: ModelService, id: string, note: string) {
    reopenHistoricalSubagent(this.database, this.modelRecovery(models), id, note)
    return this.read(id)
  }
  restorePolicy(input: SubagentPolicyRecovery, skills: RoleSkillSnapshot[]) {
    restoreSubagentPolicy(this.database, this.roles(), input, skills)
    return this.read(input.agentId)
  }
  restoreWorkspace(id: string, root: string) { restoreSubagentWorkspace(this.database, id, root); return this.read(id) }
  roles() { return new SubagentRoleRepository(this.database, this.workspace) }
  roleImport() { return new SubagentRoleImport(this.database, this.roles()) }
  skillInstructions(id: string) {
    const row = this.database.connection.prepare('SELECT skills_json FROM subagent_role_snapshots WHERE agent_id=?').get(id)
    return row ? roleSkillPrompt(JSON.parse(String(row.skills_json)) as RoleSkillSnapshot[]) : ''
  }
  requestReview() { return new SubagentRequestReview(this.database) }
  existing(key: string, expectedHash?: string) {
    const row = this.database.connection.prepare('SELECT id,spawn_request_hash FROM subagent_threads WHERE operation_key=?').get(key)
    if (row && expectedHash !== undefined && row.spawn_request_hash !== expectedHash) {
      throw new Error(row.spawn_request_hash == null ? 'Existing task has no verifiable creation request; inspect it before creating another task' : 'Idempotency key belongs to a different subagent creation request')
    }
    return row ? this.read(String(row.id)) : undefined
  }
  parent(sessionId: string) {
    const row = this.database.connection.prepare('SELECT id,parent_id,root_session_id,depth,agent_path FROM subagent_threads WHERE child_session_id=?').get(sessionId)
    return row ? { id: String(row.id), parentId: row.parent_id === null ? null : String(row.parent_id), rootSessionId: String(row.root_session_id), depth: Number(row.depth), path: String(row.agent_path) } : undefined
  }
  directChildren(sessionId: string) {
    return this.database.connection.prepare("SELECT id,child_session_id,state FROM subagent_threads WHERE parent_session_id=?").all(sessionId)
      .map(row => ({ id: String(row.id), sessionId: String(row.child_session_id), state: String(row.state) }))
  }
  assertDescendant(sessionId: string, agentId: string): void {
    let current = this.raw(agentId)
    const visited = new Set<string>()
    for (let depth = 0;depth < 4;depth++) {
      const id = String(current.id)
      if (visited.has(id)) throw new Error('Subagent parent relationship contains a cycle')
      visited.add(id)
      if (current.parent_session_id === sessionId) return
      if (current.parent_id == null) break
      current = this.raw(String(current.parent_id))
    }
    throw new Error('Subagent is outside this session’s descendant tree')
  }
  capacity(rootSessionId: string) {
    const count = Number(this.database.connection.prepare("SELECT COUNT(*) AS n FROM subagent_threads WHERE root_session_id=? AND state IN ('queued','running')").get(rootSessionId)?.n)
    if (count >= 4) throw new Error('Subagent concurrency budget reached (four active threads)')
  }
  create(parentSessionId: string, childSessionId: string, taskName: string, role: string, message: string, key: string, maxTurns: number, timeoutMs: number, maxModelRequests = 128, maxToolCalls = 256, maxTokens = 1000000, maxCostMicrousd: number | null = null, skillSnapshots: RoleSkillSnapshot[] = [], actorId?: string | number) {
    return this.database.transaction(() => {
      const requestHash = spawnRequestHash(parentSessionId, taskName, role, message, maxTurns, timeoutMs, maxModelRequests, maxToolCalls, maxTokens, maxCostMicrousd, actorId)
      const old = this.existing(key, requestHash)
      if (old) return old
      const parent = this.parent(parentSessionId), root = parent?.rootSessionId ?? parentSessionId
      this.capacity(root)
      const depth = (parent?.depth ?? 0) + 1
      if (depth > 4) throw new Error('Subagent nesting budget reached')
      const id = randomUUID(), now = Date.now(), agentPath = `${parent?.path ?? '/root'}/${taskName}`
      const definition = this.roles().read(role)
      if (JSON.stringify(definition.skills) !== JSON.stringify(skillSnapshots.map(skill => skill.name))) throw new Error('Role skills changed before task creation')
      const requestedPolicy = rolePolicy(role, definition), inheritedPolicy = subagentPolicy(this.database, parentSessionId)
      const policy = inheritedPolicy ? narrowPolicy(inheritedPolicy, requestedPolicy) : requestedPolicy
      assertRoleSkillPolicy(skillSnapshots, policy)
      this.database.connection.prepare(`INSERT INTO subagent_threads(id,root_session_id,parent_session_id,child_session_id,parent_id,agent_path,task_name,role,
        depth,state,operation_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?,?)`).run(id, root, parentSessionId, childSessionId, parent?.id ?? null, agentPath, taskName, role, depth, key, now, now)
      if (actorId !== undefined) this.database.connection.prepare('UPDATE subagent_threads SET parent_actor_id=? WHERE id=?').run(String(actorId), id)
      this.database.connection.prepare('INSERT INTO subagent_policies VALUES(?,?,?)').run(id, JSON.stringify(policy), now)
      this.database.connection.prepare('UPDATE subagent_threads SET workspace_root=? WHERE id=?').run(this.workspace(), id)
      this.database.connection.prepare('INSERT INTO subagent_role_snapshots VALUES(?,?,?,?)').run(id, JSON.stringify(definition), JSON.stringify(skillSnapshots), now)
      const parentDeadline = parent ? this.raw(parent.id).deadline_at : null
      const deadline = Math.min(now + Math.min(timeoutMs, definition.timeoutMs), parentDeadline == null ? Number.MAX_SAFE_INTEGER : Number(parentDeadline))
      if (deadline <= now) throw new Error('Parent task deadline has elapsed')
      const costLimit = maxCostMicrousd === null ? definition.maxCostMicrousd : definition.maxCostMicrousd === null ? maxCostMicrousd : Math.min(maxCostMicrousd, definition.maxCostMicrousd)
      this.database.connection.prepare('UPDATE subagent_threads SET max_turns=?,deadline_at=?,spawn_request_hash=?,max_model_requests=?,max_tool_calls=?,max_tokens=?,max_cost_microusd=? WHERE id=?')
        .run(Math.min(maxTurns, definition.maxTurns), deadline, requestHash, Math.min(maxModelRequests, definition.maxModelRequests), Math.min(maxToolCalls, definition.maxToolCalls), Math.min(maxTokens, definition.maxTokens), costLimit, id)
      this.schedule(id, childSessionId, message, `${key}:initial`, depth)
      return this.read(id)
    })
  }
  existingFollowup(id: string, key: string | undefined, message: string) {
    if (key === undefined) return undefined
    const row = this.database.connection.prepare('SELECT message FROM subagent_followups WHERE agent_id=? AND operation_key=?').get(id, key)
    if (!row) return undefined
    if (row.message !== message) throw new Error('Follow-up key belongs to different content')
    return this.read(id)
  }
  followup(id: string, message: string, key: string = randomUUID(), onCommit?: () => void) {
    return this.database.transaction(() => {
      const existing = this.existingFollowup(id, key, message)
      if (existing) { onCommit?.(); return existing }
      const current = this.raw(id)
      assertSubagentWorkspace(this.database, String(current.child_session_id))
      assertSettledSubagentRequests(this.database, id)
      if (this.database.connection.prepare("SELECT 1 FROM legacy_subagent_context WHERE agent_id=? AND state!='ready'").get(id)) throw new Error('Historical subagent context and policy must be restored before follow-up')
      if (['queued', 'running'].includes(String(current.state))) throw new Error('Subagent already has an active task')
      if (Number(current.turns_used) >= Number(current.max_turns)) throw new Error('Subagent turn budget is exhausted')
      if (current.deadline_at != null && Number(current.deadline_at) <= Date.now()) throw new Error('Subagent deadline has elapsed')
      this.capacity(String(current.root_session_id))
      this.database.connection.prepare('UPDATE subagent_threads SET turns_used=turns_used+1 WHERE id=?').run(id)
      this.database.connection.prepare('INSERT INTO subagent_followups VALUES (?, ?, ?, ?)').run(id, key, message, Date.now())
      this.schedule(id, String(current.child_session_id), message, `agent-followup:${id}:${key}`, Number(current.depth))
      this.database.connection.prepare("UPDATE subagent_threads SET state='queued',error=NULL,result_json=NULL,completed_at=NULL,updated_at=? WHERE id=?").run(Date.now(), id)
      onCommit?.()
      return this.read(id)
    })
  }
  private schedule(id: string, sessionId: string, message: string, key: string, depth: number) {
    const job = this.jobs.scheduleInTransaction({ kind: 'subagent.turn', sessionId, dueAt: Date.now(), payload: { agentId: id, message }, key, causationId: id, depth })
    this.database.connection.prepare('UPDATE subagent_threads SET latest_job_id=? WHERE id=?').run(job.id, id)
  }
  interrupt(id: string, reason = 'Interrupted by user or parent') {
    this.database.transaction(() => {
      const thread = this.raw(id), now = Date.now()
      this.database.connection.prepare("UPDATE jobs SET state='cancelled',updated_at=? WHERE session_id=? AND kind='subagent.turn' AND state='queued'").run(now, thread.child_session_id!)
      this.database.connection.prepare("UPDATE subagent_threads SET state='interrupted',error=?,completed_at=?,updated_at=? WHERE id=?").run(reason, now, now, id)
    })
  }
  started(id: string) { this.database.connection.prepare("UPDATE subagent_threads SET state='running',started_at=COALESCE(started_at,?),updated_at=? WHERE id=?").run(Date.now(), Date.now(), id) }
  list(sessionId: string) {
    const root = this.parent(sessionId)?.rootSessionId ?? sessionId
    return this.database.connection.prepare('SELECT id FROM subagent_threads WHERE root_session_id=? ORDER BY created_at,id').all(root).map(row => this.read(String(row.id)))
  }
  raw(id: string) { const row = this.database.connection.prepare('SELECT * FROM subagent_threads WHERE id=?').get(id); if (!row) throw new Error('Subagent not found'); return row }
  read(id: string) {
    const row = this.raw(id)
    const legacy = this.database.connection.prepare('SELECT state,coordination_batch_id FROM legacy_subagent_context WHERE agent_id=?').get(id)
    return {
      id, sessionId: String(row.root_session_id), childSessionId: String(row.child_session_id), parentId: row.parent_id ?? null, parentActorId: row.parent_actor_id == null ? null : String(row.parent_actor_id),
      agentPath: String(row.agent_path), taskName: String(row.task_name), role: String(row.role), status: String(row.state),
      result: row.result_json ? JSON.parse(String(row.result_json)) : null, error: row.error ?? null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
      startedAt: row.started_at ?? null, completedAt: row.completed_at ?? null, config: { depth: Number(row.depth), maxTurns: Number(row.max_turns), maxModelRequests: Number(row.max_model_requests), maxToolCalls: Number(row.max_tool_calls), maxTokens: Number(row.max_tokens), maxCostMicrousd: row.max_cost_microusd == null ? null : Number(row.max_cost_microusd) }, usage: { turns: Number(row.turns_used), modelRequests: Number(row.model_requests_used), toolCalls: Number(row.tool_calls_used), tokens: Number(row.tokens_used), costMicrousd: Number(row.cost_microusd_used), tokensUnknown: Boolean(row.usage_unknown), costUnknown: Boolean(row.cost_unknown) }, deadlineAt: row.deadline_at ?? null, coordinationBatchId: legacy?.coordination_batch_id ?? null, recoveryState: legacy ? String(legacy.state) : null, workspaceRoot: row.workspace_root == null ? null : String(row.workspace_root)
    }
  }
  active() {
    return this.database.connection.prepare("SELECT id FROM subagent_threads WHERE state IN ('queued','running') ORDER BY created_at LIMIT 1000").all().map(row => this.read(String(row.id)))
  }
  settle() {
    this.jobs.settleInputs()
    settleSubagentThreads(this.database)
  }
}

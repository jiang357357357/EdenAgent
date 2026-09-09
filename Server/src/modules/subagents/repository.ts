import { settleSubagentThreads } from './settlement.ts'
import { spawnRequestHash } from './spawn-identity.ts'
import { randomUUID } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import type { JobRepository } from '../jobs/index.ts'
export class SubagentRepository {
  constructor(private readonly database: EdenDatabase, private readonly jobs: JobRepository) {}
  existing(key: string, expectedHash?: string) {
    const row = this.database.connection.prepare('SELECT id,spawn_request_hash FROM subagent_threads WHERE operation_key=?').get(key)
    if (row && expectedHash !== undefined && row.spawn_request_hash !== expectedHash) {
      throw new Error(row.spawn_request_hash == null ? 'Existing task has no verifiable creation request; inspect it before creating another task' : 'Idempotency key belongs to a different subagent creation request')
    }
    return row ? this.read(String(row.id)) : undefined
  }
  parent(sessionId: string) {
    const row = this.database.connection.prepare('SELECT id,root_session_id,depth,agent_path FROM subagent_threads WHERE child_session_id=?').get(sessionId)
    return row ? { id: String(row.id), rootSessionId: String(row.root_session_id), depth: Number(row.depth), path: String(row.agent_path) } : undefined
  }
  directChildren(sessionId: string) {
    return this.database.connection.prepare("SELECT id,child_session_id,state FROM subagent_threads WHERE parent_session_id=?").all(sessionId)
      .map(row => ({ id: String(row.id), sessionId: String(row.child_session_id), state: String(row.state) }))
  }
  assertDescendant(sessionId: string, agentId: string): void {
    let current = this.raw(agentId)
    const visited = new Set<string>()
    for (let depth = 0; depth < 4; depth++) {
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
  create(parentSessionId: string, childSessionId: string, taskName: string, role: string, message: string, key: string, maxTurns: number, timeoutMs: number, maxModelRequests = 128, maxToolCalls = 256) {
    return this.database.transaction(() => {
      const requestHash = spawnRequestHash(parentSessionId, taskName, role, message, maxTurns, timeoutMs, maxModelRequests, maxToolCalls)
      const old = this.existing(key, requestHash)
      if (old) return old
      const parent = this.parent(parentSessionId), root = parent?.rootSessionId ?? parentSessionId
      this.capacity(root)
      const depth = (parent?.depth ?? 0) + 1
      if (depth > 4) throw new Error('Subagent nesting budget reached')
      const id = randomUUID(), now = Date.now(), agentPath = `${parent?.path ?? '/root'}/${taskName}`
      this.database.connection.prepare(`INSERT INTO subagent_threads(id,root_session_id,parent_session_id,child_session_id,parent_id,agent_path,task_name,role,
        depth,state,operation_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?,?)`).run(id, root, parentSessionId, childSessionId, parent?.id ?? null, agentPath, taskName, role, depth, key, now, now)
      const parentDeadline = parent ? this.raw(parent.id).deadline_at : null
      const deadline = Math.min(now + timeoutMs, parentDeadline == null ? Number.MAX_SAFE_INTEGER : Number(parentDeadline))
      if (deadline <= now) throw new Error('Parent task deadline has elapsed')
      this.database.connection.prepare('UPDATE subagent_threads SET max_turns=?,deadline_at=?,spawn_request_hash=?,max_model_requests=?,max_tool_calls=? WHERE id=?').run(maxTurns, deadline, requestHash, maxModelRequests, maxToolCalls, id)
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
  followup(id: string, message: string, key = randomUUID()) {
    return this.database.transaction(() => {
      const existing = this.existingFollowup(id, key, message)
      if (existing) return existing
      const current = this.raw(id)
      if (['queued', 'running'].includes(String(current.state))) throw new Error('Subagent already has an active task')
      if (Number(current.turns_used) >= Number(current.max_turns)) throw new Error('Subagent turn budget is exhausted')
      if (current.deadline_at != null && Number(current.deadline_at) <= Date.now()) throw new Error('Subagent deadline has elapsed')
      this.capacity(String(current.root_session_id))
      this.database.connection.prepare('UPDATE subagent_threads SET turns_used=turns_used+1 WHERE id=?').run(id)
      this.database.connection.prepare('INSERT INTO subagent_followups VALUES (?, ?, ?, ?)').run(id, key, message, Date.now())
      this.schedule(id, String(current.child_session_id), message, `agent-followup:${id}:${key}`, Number(current.depth))
      this.database.connection.prepare("UPDATE subagent_threads SET state='queued',error=NULL,result_json=NULL,completed_at=NULL,updated_at=? WHERE id=?").run(Date.now(), id)
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
    return { id, sessionId: String(row.root_session_id), childSessionId: String(row.child_session_id), parentId: row.parent_id ?? null,
      agentPath: String(row.agent_path), taskName: String(row.task_name), role: String(row.role), status: String(row.state),
      result: row.result_json ? JSON.parse(String(row.result_json)) : null, error: row.error ?? null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
      startedAt: row.started_at ?? null, completedAt: row.completed_at ?? null, config: { depth: Number(row.depth), maxTurns: Number(row.max_turns), maxModelRequests: Number(row.max_model_requests), maxToolCalls: Number(row.max_tool_calls) }, usage: { turns: Number(row.turns_used), modelRequests: Number(row.model_requests_used), toolCalls: Number(row.tool_calls_used) }, deadlineAt: row.deadline_at ?? null, coordinationBatchId: null }
  }
  active() {
    return this.database.connection.prepare("SELECT id FROM subagent_threads WHERE state IN ('queued','running') ORDER BY created_at LIMIT 1000").all().map(row => this.read(String(row.id)))
  }
  settle() {
    this.jobs.settleInputs()
    settleSubagentThreads(this.database)
  }
}

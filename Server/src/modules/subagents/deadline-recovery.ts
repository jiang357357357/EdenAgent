import { subagentRoleInfoSchema } from '@eden/api'
import type { SubagentDeadlineRecovery } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import { assertSubagentWorkspace } from './workspace-owner.ts'
import type { SQLOutputValue, DatabaseSync } from 'node:sqlite'

export function renewHistoricalDeadline(database: EdenDatabase, input: SubagentDeadlineRecovery): void {
  database.transaction(() => {
    const db = database.connection, serialized = JSON.stringify(input)
    const previous = db.prepare('SELECT request_json FROM subagent_deadline_restorations WHERE id=?').get(input.idempotencyKey)
    if (previous) {
      if (previous.request_json !== serialized) throw new Error('Renewal key belongs to a different request')
      return
    }
    const thread = db.prepare('SELECT * FROM subagent_threads WHERE id=?').get(input.agentId)
    const legacy = db.prepare('SELECT state FROM legacy_subagent_context WHERE agent_id=?').get(input.agentId)
    if (!thread || !legacy || legacy.state === 'ready') throw new Error('Deadline recovery only applies to historical tasks awaiting reopening')
    if (thread.deadline_at !== input.expectedDeadline) throw new Error('Task deadline changed; reload before confirming renewal')
    assertSubagentWorkspace(database, String(thread.child_session_id))
    const active = db.prepare(`WITH RECURSIVE tree(id,child_session_id,state) AS (
      SELECT id,child_session_id,state FROM subagent_threads WHERE id=? UNION
      SELECT t.id,t.child_session_id,t.state FROM subagent_threads t JOIN tree p ON t.parent_id=p.id)
      SELECT 1 FROM tree t WHERE t.state IN ('queued','running') OR EXISTS(
        SELECT 1 FROM inputs i WHERE i.session_id=t.child_session_id AND i.state='running') LIMIT 1`).get(input.agentId)
    if (active) throw new Error('Stop the task and its descendants before renewing its deadline')
    const snapshot = db.prepare('SELECT definition_json FROM subagent_role_snapshots WHERE agent_id=?').get(input.agentId)
    if (!snapshot) throw new Error('Restore the role policy before renewing the deadline')
    const definition = subagentRoleInfoSchema.parse(JSON.parse(String(snapshot.definition_json)))
    const { deadline, now } = renewedDeadline(input, definition, thread, db)
    db.prepare('INSERT INTO subagent_deadline_restorations VALUES(?,?,?,?,?,?,?)')
      .run(input.idempotencyKey, input.agentId, serialized, thread.deadline_at!, deadline, input.note, now)
    db.prepare('UPDATE subagent_threads SET deadline_at=?,updated_at=? WHERE id=?').run(deadline, now, input.agentId)
  })
}

function renewedDeadline(input: SubagentDeadlineRecovery, definition: { timeoutMs: number }, thread: Record<string, SQLOutputValue>, db: DatabaseSync) {
  const now = Date.now()
  let deadline = now + Math.min(input.timeoutMs, definition.timeoutMs)
  if (thread.parent_id != null) {
    const parent = db.prepare('SELECT workspace_root,deadline_at FROM subagent_threads WHERE id=?').get(thread.parent_id)
    if (!parent || parent.workspace_root !== thread.workspace_root) throw new Error('Restore parent workspace ownership first')
    if (parent.deadline_at != null) deadline = Math.min(deadline, Number(parent.deadline_at))
  }
  if (deadline <= now) throw new Error('Renew the parent deadline first')
  if (thread.deadline_at != null && deadline <= Number(thread.deadline_at)) throw new Error('Requested renewal does not extend the current deadline')
  return { deadline, now }
}

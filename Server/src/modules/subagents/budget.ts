import type { EdenDatabase } from '@eden/store'

/** Admission is charged with its durable request record, before the model/tool can run. */
export function chargeSubagentBudget(database: EdenDatabase, sessionId: string, kind: 'model' | 'tool'): void {
  if (!database.inTransaction) throw new Error('Subagent budget requires an owning transaction')
  let row = database.connection.prepare('SELECT * FROM subagent_threads WHERE child_session_id=?').get(sessionId)
  const visited = new Set<string>()
  while (row) {
    const id = String(row.id)
    if (visited.has(id) || visited.size >= 4) throw new Error('Invalid subagent budget ancestry')
    visited.add(id)
    if (visited.size === 1 && !['queued', 'running'].includes(String(row.state))) throw new Error('Subagent or ancestor is no longer active')
    if (row.deadline_at != null && Number(row.deadline_at) <= Date.now()) throw new Error('Subagent deadline reached')
    const column = kind === 'model' ? 'model_requests_used' : 'tool_calls_used'
    const limit = Number(kind === 'model' ? row.max_model_requests : row.max_tool_calls)
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid persisted subagent budget')
    if (Number(row[column]) >= limit) throw new Error(`Subagent subtree ${kind} budget exhausted (${limit})`)
    database.connection.prepare(`UPDATE subagent_threads SET ${column}=${column}+1,updated_at=? WHERE id=?`).run(Date.now(), id)
    if (row.parent_id == null) break
    row = database.connection.prepare('SELECT * FROM subagent_threads WHERE id=?').get(row.parent_id)
    if (!row) throw new Error('Subagent budget ancestor is missing')
  }
}

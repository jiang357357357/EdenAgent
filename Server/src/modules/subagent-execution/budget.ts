import type { EdenDatabase } from '@eden/store'
import { assertSettledSubagentRequests } from './request-repository.ts'
import { assertSubagentWorkspace } from './workspace-owner.ts'
import type { SQLOutputValue } from 'node:sqlite'

/** Admission is charged with its durable request record, before the model/tool can run. */
export function chargeSubagentBudget(database: EdenDatabase, sessionId: string, kind: 'model' | 'tool', costConfigured = false): void {
  if (!database.inTransaction) throw new Error('Subagent budget requires an owning transaction')
  let row = database.connection.prepare('SELECT * FROM subagent_threads WHERE child_session_id=?').get(sessionId)
  const visited = new Set<string>()
  while (row) {
    const id = String(row.id)
    if (visited.has(id) || visited.size >= 4) throw new Error('Invalid subagent budget ancestry')
    visited.add(id)
    assertSubagentWorkspace(database, String(row.child_session_id))
    assertSettledSubagentRequests(database, id)
    assertBudgetAdmission(visited, row, kind, costConfigured)
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

function assertBudgetAdmission(visited: Set<string>, row: Record<string, SQLOutputValue>, kind: string, costConfigured: boolean) {
  if (visited.size === 1 && !['queued', 'running'].includes(String(row.state))) throw new Error('Subagent or ancestor is no longer active')
  if (row.deadline_at != null && Number(row.deadline_at) <= Date.now()) throw new Error('Subagent deadline reached')
  if (Number(row.usage_unknown)) throw new Error('Subagent token usage is unknown; reconcile usage before continuing')
  if (Number(row.tokens_used) >= Number(row.max_tokens)) throw new Error('Subagent subtree token budget exhausted')
  if (row.max_cost_microusd !== null) {
    if (Number(row.cost_unknown) || kind === 'model' && !costConfigured) throw new Error('Subagent cost limit requires known usage and configured model rates')
    if (Number(row.cost_microusd_used) >= Number(row.max_cost_microusd)) throw new Error('Subagent subtree estimated cost budget exhausted')
  }
}

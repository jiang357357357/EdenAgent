import { createHash } from 'node:crypto'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import type { LegacyRow } from './snapshot-format.ts'
import { legacyText, legacyUuid, legacyTime, legacyJson } from './fields.ts'
function derivedId(id: string, kind: string): string {
  const bytes = createHash('sha256').update(`eden:legacy:subagent:${kind}:${id}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
function object(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid historical agent configuration or usage')
  return value as Record<string, unknown>
}
function count(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid historical agent budget or usage')
  return value
}
export function convertLegacyThread(db: DatabaseSync, row: LegacyRow): void {
  const id = legacyUuid(row, 'id'), root = legacyUuid(row, 'session_id')
  const { parent, task, session, parentId, agentPath, depth } = threadAncestry(row, db, root)
  const child = derivedId(id, 'session'), parentSession = parent ? String(parent.child_session_id) : root
  const created = legacyTime(row.created_at), updated = legacyTime(row.updated_at)
  const originalState = legacyText(row, 'status')
  if (!['queued', 'running', 'completed', 'failed', 'interrupted'].includes(originalState)) throw new Error('Unsupported historical subagent state')
  const state = ['queued', 'running'].includes(originalState) ? 'interrupted' : originalState
  const configJson = row.config_json === undefined ? '{}' : legacyJson(row, 'config_json')
  const usageJson = row.usage_json === undefined ? '{}' : legacyJson(row, 'usage_json')
  const config = object(configJson), usage = object(usageJson)
  const budget = config.budget === undefined ? {} : object(JSON.stringify(config.budget))
  db.prepare("INSERT INTO sessions(id,title,origin,status,created_at,updated_at) VALUES(?,?,?,'closed',?,?)").run(child, task, session.origin!, created, updated)
  db.prepare(`INSERT INTO events(id,session_id,turn_id,seq,kind,payload_json,created_at) VALUES(?,?,NULL,1,'session.metadata.updated',?,?)`)
    .run(derivedId(id, 'metadata'), child, JSON.stringify({ participants: [], environment: { sessionPurpose: 'subagent', parentSessionId: parentSession, legacyAgentId: id } }), created)
  db.prepare(`INSERT INTO subagent_threads(id,root_session_id,parent_session_id,child_session_id,parent_id,agent_path,task_name,role,depth,state,
    operation_key,result_json,error,created_at,updated_at,started_at,completed_at,max_turns,turns_used,deadline_at,model_requests_used,tool_calls_used,max_model_requests,max_tool_calls)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, root, parentSession, child, parentId, agentPath, task, legacyText(row, 'role'), depth, state,
    `legacy-agent:${id}`, row.result_json === null ? null : legacyJson(row, 'result_json'), row.error === null ? null : legacyText(row, 'error'), created, updated,
    row.started_at === null ? null : legacyTime(row.started_at), row.completed_at === null ? null : legacyTime(row.completed_at),
    count(budget.max_turns, 64), count(usage.turns, 0), row.deadline_at == null ? null : legacyTime(row.deadline_at),
    count(usage.modelRequests, 0), count(usage.toolCalls, 0), 128, count(budget.max_tool_calls, 128))
  db.prepare(`UPDATE subagent_threads SET max_tokens=?,max_cost_microusd=?,tokens_used=?,cost_microusd_used=?,usage_unknown=?,cost_unknown=? WHERE id=?`)
    .run(count(budget.max_tokens, 1000000), count(budget.max_cost_microusd, 10000000), count(usage.tokens, 0), count(usage.costMicrousd, 0),
      Number(usage.tokens === undefined), Number(usage.costMicrousd === undefined), id)
  db.prepare('UPDATE subagent_threads SET legacy_usage_unknown=usage_unknown,legacy_cost_unknown=cost_unknown WHERE id=?').run(id)
  db.prepare('INSERT INTO legacy_subagent_context VALUES(?,?,?,?,?,?,?)').run(id, legacyText(row, 'prompt'),
    row.context_json === null ? null : legacyJson(row, 'context_json'), configJson, usageJson,
    row.coordination_batch_id == null ? null : legacyText(row, 'coordination_batch_id'), 'context_required')
  db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run('agent_threads', id, id)
  db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run('agent_child_sessions', id, child)
}

function threadAncestry(row: LegacyRow, db: DatabaseSync, root: string) {
  const parentId = row.parent_id === null ? null : legacyUuid(row, 'parent_id')
  const parent = parentId === null ? undefined : db.prepare('SELECT * FROM subagent_threads WHERE id=?').get(parentId)
  if (parentId !== null && (!parent || parent.root_session_id !== root)) throw new Error('Historical subagent parent belongs to another session or is missing')
  const session = db.prepare('SELECT origin FROM sessions WHERE id=?').get(root)
  if (!session) throw new Error('Historical subagent root session is missing')
  const agentPath = legacyText(row, 'agent_path'), task = legacyText(row, 'task_name')
  assertThreadPath(parent, agentPath, task)
  const depth = parent ? Number(parent.depth) + 1 : 1
  return { parent, task, session, parentId, agentPath, depth }
}

function assertThreadPath(parent: Record<string, SQLOutputValue> | undefined, agentPath: string, task: string) {
  const parentPath = parent ? String(parent.agent_path) : '/root', leaf = agentPath.slice(parentPath.length + 1)
  const suffix = leaf.startsWith(`${task}_`) ? leaf.slice(task.length + 1) : ''
  if (!task || task.includes('/') || !agentPath.startsWith(`${parentPath}/`) || leaf.includes('/')
    || (leaf !== task && (!/^[0-9]+$/.test(suffix) || Number(suffix) < 2))) throw new Error('Historical subagent path does not match its parent')
}

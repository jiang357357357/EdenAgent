import type { EdenDatabase } from '@eden/store'
import type { JsonValue } from '@eden/api'

export function recordSubagentRequest(database: EdenDatabase, sessionId: string, turnId: string, snapshot: JsonValue): void {
  if (!database.inTransaction) throw new Error('Request recording requires an owning transaction')
  const db = database.connection
  let row = db.prepare('SELECT * FROM subagent_threads WHERE child_session_id=?').get(sessionId)
  if (!row) return
  const value = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {}
  if (typeof value.requestId !== 'string') throw new Error('Subagent model request has no correlation ID')
  db.prepare("INSERT INTO subagent_model_requests VALUES(?,?,?,?,'pending',?,?,NULL,NULL)").run(value.requestId, row.id!, sessionId, turnId, Number(value.costConfigured === true), Date.now())
  const seen = new Set<string>()
  while (row) {
    const id = String(row.id)
    if (seen.has(id) || seen.size >= 4) throw new Error('Invalid subagent request ancestry')
    seen.add(id)
    db.prepare('INSERT INTO subagent_request_owners VALUES(?,?)').run(value.requestId, id)
    if (row.parent_id == null) break
    row = db.prepare('SELECT * FROM subagent_threads WHERE id=?').get(row.parent_id)
    if (!row) throw new Error('Subagent request ancestor is missing')
  }
}

export function assertSettledSubagentRequests(database: EdenDatabase, agentId: string): void {
  const missing = database.connection.prepare(`SELECT 1 FROM subagent_request_owners o JOIN subagent_model_requests r ON r.id=o.request_id
    WHERE o.agent_id=? AND r.state='pending' AND NOT EXISTS(SELECT 1 FROM inputs i WHERE i.session_id=r.session_id AND i.turn_id=r.turn_id AND i.state='running') LIMIT 1`).get(agentId)
  if (missing) throw new Error('Subagent subtree has a model request with an unknown outcome; review its usage before continuing')
}

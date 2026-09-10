import { operationListSchema, operationResolveSchema, toJson } from '@eden/api'
import type { SessionRepository } from '../sessions/index.ts'
export class OperationRepository {
  constructor(private readonly sessions: SessionRepository) { }
  read(id: string) {
    const db = this.sessions.database.connection
    const row = db.prepare('SELECT * FROM tool_operations WHERE id=?').get(id)
    if (!row) throw new Error('Operation not found in this world')
    this.sessions.read(String(row.session_id))
    const permission = db.prepare('SELECT capability,resource FROM permission_requests WHERE operation_id=? ORDER BY created_at DESC LIMIT 1').get(id)
    return {
      operationId: id, sessionId: String(row.session_id), turnId: String(row.turn_id), toolCallId: row.tool_call_id === null ? id.slice(String(row.turn_id).length + 1) : String(row.tool_call_id),
      toolName: String(row.tool_name), capability: String(row.capability ?? permission?.capability ?? 'tool.execute'), resource: String(row.resource ?? permission?.resource ?? row.tool_name),
      state: String(row.state), request: toJson(JSON.parse(String(row.request_json))), result: row.result_json == null ? null : toJson(JSON.parse(String(row.result_json))),
      error: row.error_json == null ? null : toJson(JSON.parse(String(row.error_json))), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at)
    }
  }
  list(raw: unknown) {
    const input = operationListSchema.parse(raw)
    if (input.sessionId) this.sessions.read(input.sessionId)
    return this.sessions.database.connection.prepare(`SELECT o.id FROM tool_operations o JOIN sessions s ON s.id=o.session_id
      WHERE s.status!='deleted' AND (? IS NULL OR o.session_id=?) AND (? IS NULL OR o.state=?) ORDER BY o.created_at DESC,o.id DESC LIMIT ?`)
      .all(input.sessionId ?? null, input.sessionId ?? null, input.state ?? null, input.state ?? null, input.limit).map(row => this.read(String(row.id)))
  }
  resolve(raw: unknown) {
    const input = operationResolveSchema.parse(raw)
    const event = this.sessions.database.transaction(() => {
      const current = this.read(input.operationId)
      if (current.state !== 'unknown') throw new Error('Operation is not awaiting review')
      const error = { code: 'user_resolved_unknown', decision: input.decision }
      const changed = this.sessions.database.connection.prepare("UPDATE tool_operations SET state='failed',error_json=?,updated_at=? WHERE id=? AND state='unknown'")
        .run(JSON.stringify(error), Date.now(), input.operationId)
      if (changed.changes !== 1) throw new Error('Operation changed before review')
      return this.sessions.events.insert(current.sessionId, current.turnId, 'operation.resolved', { operationId: input.operationId, ...error })
    })
    this.sessions.events.publish(event)
    return this.read(input.operationId)
  }
}

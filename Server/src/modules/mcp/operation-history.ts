import { toJson, mcpOperationListSchema, type JsonValue } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
export function mcpOperationHistory(database: EdenDatabase, raw: JsonValue) {
  const input = mcpOperationListSchema.parse(raw)
  if (!database.connection.prepare('SELECT 1 FROM sessions WHERE id=?').get(input.sessionId)) throw new Error('Session is not present in this world')
  const rows = database.connection.prepare(`SELECT rowid AS cursor,id,runtime_id,revision,method,name,state,error,created_at,updated_at
    FROM mcp_operations WHERE session_id=? AND rowid<? ORDER BY rowid DESC LIMIT 51`).all(input.sessionId, input.before ?? Number.MAX_SAFE_INTEGER)
  return toJson({ items: rows.slice(0, 50).map(row => ({ id: String(row.id), runtimeId: String(row.runtime_id), revision: String(row.revision),
    method: String(row.method), name: String(row.name), state: String(row.state), error: row.error === null ? null : String(row.error),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) })), nextCursor: rows.length > 50 ? Number(rows[49]!.cursor) : null })
}

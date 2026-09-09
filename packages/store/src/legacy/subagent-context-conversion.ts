import type { DatabaseSync } from 'node:sqlite'
import { legacyContextCheckpoint } from '@eden/runtime-pi'
import { toJson } from '@eden/api'
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Historical subagent context is not an object')
  return raw as Record<string, unknown>
}
function messages(context: string | null, configuration: string) {
  const config = object(JSON.parse(configuration))
  const value = context === null ? config.parentHistory ?? [] : object(JSON.parse(context)).messages
  if (!Array.isArray(value)) throw new Error('Historical subagent messages are missing')
  return value.filter(raw => {
    const message = object(raw)
    if (typeof message.role !== 'string' || (!Array.isArray(message.content) && typeof message.content !== 'string')) throw new Error('Historical subagent message is invalid')
    return message.transient !== true
  })
}

/** Restore transcript into the dedicated child only; session reopening and policy recovery are separate actions. */
export function convertLegacySubagentContexts(db: DatabaseSync): void {
  let after = ''
  while (true) {
    const rows = db.prepare(`SELECT c.*,t.child_session_id,t.agent_path,t.role,t.created_at FROM legacy_subagent_context c
      JOIN subagent_threads t ON t.id=c.agent_id WHERE c.agent_id>? AND c.state='context_required' ORDER BY c.agent_id LIMIT 64`).all(after)
    if (!rows.length) return
    for (const row of rows) {
      after = String(row.agent_id)
      const childId = String(row.child_session_id)
      let checkpoint: ReturnType<typeof legacyContextCheckpoint>
      try {
        const history = messages(row.context_json === null ? null : String(row.context_json), String(row.config_json))
        checkpoint = legacyContextCheckpoint(childId, [toJson({ kind: 'historical_subagent_task', agentId: after, agentPath: String(row.agent_path),
          role: String(row.role), prompt: String(row.prompt), checkpointPresent: row.context_json !== null }), ...history.map(message => toJson({ kind: 'historical_message', message }))], Number(row.created_at))
      } catch (error) {
        db.prepare("INSERT INTO legacy_runtime_contexts VALUES(?,'review_required',?,?) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state,error=excluded.error,updated_at=excluded.updated_at")
          .run(childId, (error instanceof Error ? error.message : 'Historical subagent context could not be restored').slice(0, 2000), Date.now())
        continue
      }
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('INSERT INTO runtime_checkpoints VALUES(?,?,?)').run(childId, JSON.stringify(checkpoint), Date.now())
        db.prepare("INSERT INTO legacy_runtime_contexts VALUES(?,'prepared',NULL,?) ON CONFLICT(session_id) DO UPDATE SET state='prepared',error=NULL,updated_at=excluded.updated_at").run(childId, Date.now())
        db.prepare("UPDATE legacy_subagent_context SET state='context_prepared_policy_required' WHERE agent_id=? AND state='context_required'").run(row.agent_id!)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    }
  }
}

import type { EdenDatabase } from '@eden/store'
import type { SubagentModelRecovery } from './model-recovery.ts'
import { subagentRecoveryStatus } from './recovery-status.ts'
import { subagentPolicy } from './tool-policy.ts'

/** Configuration activation only: explicit future follow-up supplies new work. */
export function reopenHistoricalSubagent(database: EdenDatabase, models: SubagentModelRecovery, agentId: string, note: string) {
  database.transaction(() => {
    const db = database.connection
    const previous = db.prepare('SELECT note FROM subagent_reopen_restorations WHERE agent_id=?').get(agentId)
    if (previous) {
      if (previous.note !== note) throw new Error('Task reopening was already confirmed with different evidence')
      return
    }
    const status = subagentRecoveryStatus(database, agentId)
    if (status.legacyState !== 'model_prepared_reopen_required' || status.sessionStatus !== 'closed') throw new Error('Task is not awaiting historical session reopening')
    const missing = status.checks.filter(item => item.key !== 'legacyReady' && !item.satisfied)
    if (missing.length) throw new Error(`Resolve task recovery conditions first: ${missing.map(item => item.key).join(', ')}`)
    const thread = db.prepare('SELECT * FROM subagent_threads WHERE id=?').get(agentId)!
    const parent = db.prepare('SELECT status FROM sessions WHERE id=?').get(thread.parent_session_id!)
    if (parent?.status !== 'active') throw new Error('Reopen the parent session first')
    if (db.prepare("SELECT 1 FROM legacy_runtime_contexts WHERE session_id=? AND state!='prepared'").get(thread.parent_session_id!)) throw new Error('Restore the parent context first')
    if (db.prepare("SELECT 1 FROM tool_operations WHERE session_id=? AND state IN ('running','unknown') LIMIT 1").get(status.childSessionId)) throw new Error('Reconcile old tool operations before reopening')
    if (db.prepare(`SELECT 1 FROM legacy_subagent_mailbox WHERE session_id=? AND (target_path=? OR sender_path=?)
      AND state IN ('context_required','review_required') LIMIT 1`).get(thread.root_session_id!, thread.agent_path!, thread.agent_path!)) throw new Error('Reconcile historical mailbox ownership before reopening')
    subagentPolicy(database, String(thread.parent_session_id))
    const now = Date.now()
    db.prepare("UPDATE sessions SET status='active',updated_at=? WHERE id=? AND status='closed'").run(now, status.childSessionId)
    models.activateInTransaction(agentId, status.childSessionId)
    db.prepare("UPDATE legacy_subagent_context SET state='ready' WHERE agent_id=?").run(agentId)
    // Validate the entire saved policy chain before committing activation.
    subagentPolicy(database, status.childSessionId)
    db.prepare('INSERT INTO subagent_reopen_restorations VALUES(?,?,?)').run(agentId, note, now)
    db.prepare('UPDATE subagent_threads SET updated_at=? WHERE id=?').run(now, agentId)
  })
}

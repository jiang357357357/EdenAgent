import type { DatabaseSync } from 'node:sqlite'

const domains = [
  { key: 'coreIdentities', table: 'legacy_core_identities', id: 'session_id', where: "state='rebind_required'", action: 'Reconcile the Core principal and credential reference before synchronization.' },
  { key: 'coreDeliveries', table: 'legacy_core_outbox', id: 'id', where: "state IN ('held','unknown','running')", action: 'Reconcile historical deduplication keys and delivery outcomes before replay.' },
  { key: 'inputs', table: 'inputs', id: 'id', where: "state IN ('held','interrupted')", action: 'Restore compatible runtime context and explicitly settle or resume retained inputs.' },
  { key: 'jobs', table: 'jobs', id: 'id', where: "state='unknown'", action: 'Review dispatch evidence before deciding whether a job may be retried.' },
  { key: 'operations', table: 'tool_operations', id: 'id', where: "state='unknown'", action: 'Use operation review; never infer failure from a missing response.' },
  { key: 'selfAwakeRuns', table: 'self_awake_runs', id: 'id', where: "state IN ('interrupted','action_interrupted','action_failed')", action: 'Review retained decisions and execution evidence before any action recovery.' },
  { key: 'selfAwakeNotifications', table: 'self_awake_notification_history', id: 'run_id', where: "state='unknown'", action: 'Review historical transport receipts before sending another notification.' },
  { key: 'desktopReminders', table: 'desktop_reminders', id: 'id', where: "state IN ('unknown','failed')", action: 'Keep historical windows inactive until their delivery state is reviewed.' },
  { key: 'connectorEvents', table: 'connector_events', id: 'id', where: "suppression IN ('legacy_pending','legacy_unknown')", action: 'Restore authoritative ownership and explicitly decide event dispatch.' },
  { key: 'modelBindings', table: 'legacy_model_selections', id: 'source_id', where: "state='refresh_required'", action: 'Refresh the current Core entity binding and reconcile it with the historical selection.' },
] as const

/** Counts and bounded identifiers only: never put request payloads, model secrets or file contents in the report. */
export function legacyRecoverySummary(db: DatabaseSync) {
  const present = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)))
  const items = domains.map(domain => {
    if (!present.has(domain.table)) return { key: domain.key, count: 0, sampleIds: [] as string[], action: domain.action }
    // All identifiers and predicates above are compile-time constants, not snapshot-provided SQL.
    const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${domain.table} WHERE ${domain.where}`).get()?.count ?? 0)
    const ids = db.prepare(`SELECT ${domain.id} AS id FROM ${domain.table} WHERE ${domain.where} ORDER BY ${domain.id} LIMIT 20`).all()
    return { key: domain.key, count, sampleIds: ids.map(row => String(row.id)), action: domain.action }
  })
  const workspace = present.has('runtime_settings') ? db.prepare("SELECT value_json FROM runtime_settings WHERE key='workspace.legacy_import'").get() : undefined
  const selection: unknown = workspace ? JSON.parse(String(workspace.value_json)) : null
  const state = selection && typeof selection === 'object' && 'state' in selection ? String(selection.state) : 'not_imported'
  return { items, workspaceSelection: state, complete: false,
    note: 'Review counts may overlap across a job, its input, and resulting actions. Zero counts do not prove runtime compatibility or migration completion.' }
}

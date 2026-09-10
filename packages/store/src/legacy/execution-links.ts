import type { DatabaseSync } from 'node:sqlite'
import { legacyRow } from './snapshot-format.ts'

/** Repeatable link completion after domain import; never changes execution state or schedules work. */
export function linkLegacyExecutions(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE')
  try {
    const runs = db.prepare(`SELECT r.id,r.session_id,r.input_id,r.turn_id,j.input_id AS job_input,
      i.session_id AS input_session,i.turn_id AS input_turn,t.session_id AS turn_session
      FROM self_awake_runs r JOIN legacy_conversion_ids m ON m.domain='self_awake_runs' AND m.target_id=r.id
      JOIN jobs j ON j.id=r.job_id LEFT JOIN inputs i ON i.id=j.input_id LEFT JOIN turns t ON t.id=i.turn_id`).all()
    for (const row of runs) {
      if (row.job_input === null) continue
      if (row.input_session !== row.session_id || row.turn_session !== row.session_id ||
        (row.input_id !== null && row.input_id !== row.job_input) || (row.turn_id !== null && row.turn_id !== row.input_turn)) {
        throw new Error('Legacy self-awake execution linkage is ambiguous or crosses sessions')
      }
      db.prepare('UPDATE self_awake_runs SET input_id=?,turn_id=? WHERE id=?').run(row.job_input!, row.input_turn!, row.id!)
    }
    linkReminderRuns(db)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

function linkReminderRuns(db: DatabaseSync) {
  const reminders = db.prepare("SELECT source_id,row_json FROM legacy_conversion_records WHERE domain='desktop_reminders'").iterate()
  for (const item of reminders) {
    const original = legacyRow(JSON.parse(String(item.row_json)))
    if (original.run_id === null) continue
    if (typeof original.run_id !== 'string') throw new Error('Invalid legacy desktop run ID')
    const run = db.prepare('SELECT session_id,turn_id FROM self_awake_runs WHERE id=?').get(original.run_id)
    const reminder = db.prepare('SELECT session_id,turn_id FROM desktop_reminders WHERE id=?').get(item.source_id!)
    if (!run || !reminder || run.session_id !== reminder.session_id ||
      (reminder.turn_id !== null && reminder.turn_id !== run.turn_id)) throw new Error('Legacy desktop execution linkage mismatch')
    if (run.turn_id !== null) db.prepare('UPDATE desktop_reminders SET turn_id=? WHERE id=?').run(run.turn_id!, item.source_id!)
  }
}

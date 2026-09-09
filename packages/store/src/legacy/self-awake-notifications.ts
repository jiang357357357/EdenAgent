import { tableConverted } from './conversion-state.ts'
import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import { legacyText, legacyUuid, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'

/** Historical receipts do not enter the current contact dispatcher. */
export async function convertSelfAwakeNotifications(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  const name = 'self_awake_notifications'
  if (!source.manifest.tables.some(table => table.name === name)) return []
  if (tableConverted(db, name)) return [name]
  db.exec('BEGIN IMMEDIATE')
  try {
    await source.scan(name, row => {
      const runId = legacyUuid(row, 'run_id'), originalState = legacyText(row, 'state')
      if (!['pending', 'delivered', 'failed', 'suppressed'].includes(originalState)) throw new Error('Invalid legacy notification state')
      const attempts = legacyTime(row.attempts)
      if (attempts < 0) throw new Error('Invalid legacy notification attempts')
      const state = originalState === 'pending' ? 'unknown' : originalState
      db.prepare(`INSERT INTO self_awake_notification_history(run_id,requested_channel,state,original_state,payload_json,result_json,
        attempts,last_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(runId, legacyText(row, 'requested_channel'),
          state, originalState, legacyJson(row, 'payload_json'), row.result_json === null ? null : legacyJson(row, 'result_json'),
          attempts, row.last_error === null ? null : legacyText(row, 'last_error'), legacyTime(row.created_at), legacyTime(row.updated_at))
      db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run(name, runId, runId)
      db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run(name, runId, preserveLegacyRow(row))
    })
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name=?").run(name)
    db.exec('COMMIT')
    return [name]
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

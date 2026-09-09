import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import { tableConverted } from './conversion-state.ts'
import { legacyText, legacyUuid, legacyTime, preserveLegacyRow } from './fields.ts'
export async function convertLegacyDesktop(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  const name = 'desktop_reminders'
  if (!source.manifest.tables.some(table => table.name === name)) return []
  if (tableConverted(db, name)) return [name]
  db.exec('BEGIN IMMEDIATE')
  try {
    await source.scan(name, row => {
      const id = legacyUuid(row, 'id'), session = legacyUuid(row, 'session_id'), state = legacyText(row, 'state')
      if (!['launching', 'open', 'closed', 'failed', 'unknown'].includes(state)) throw new Error('Invalid legacy desktop reminder state')
      const run = row.run_id === null ? undefined : db.prepare('SELECT session_id,turn_id,author_json FROM self_awake_runs WHERE id=?').get(legacyUuid(row, 'run_id'))
      if (row.run_id !== null && (!run || run.session_id !== session)) throw new Error('Legacy desktop reminder run ownership mismatch')
      db.prepare(`INSERT INTO desktop_reminders(id,session_id,turn_id,title,message,state,author_json,operation_key,created_at,displayed_at,closed_at)
        VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL)`).run(id, session, run?.turn_id ?? null, legacyText(row, 'title'), legacyText(row, 'message'),
          state === 'launching' ? 'unknown' : state === 'open' ? 'displayed' : state, run?.author_json ?? '{}', `legacy-desktop:${id}`, legacyTime(row.created_at))
      db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run(name, id, id)
      db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run(name, id, preserveLegacyRow(row))
    })
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name=?").run(name)
    db.exec('COMMIT')
    return [name]
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import { tableConverted } from './conversion-state.ts'
import { legacyText, legacyUuid, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'

export async function convertLegacyMedia(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  const name = 'media_requests'
  if (!source.manifest.tables.some(table => table.name === name)) return []
  if (tableConverted(db, name)) return [name]
  db.exec('BEGIN IMMEDIATE')
  try {
    await source.scan(name, row => {
      const id = legacyUuid(row, 'id'), kind = legacyText(row, 'kind'), state = legacyText(row, 'state')
      if (!['screen', 'camera'].includes(kind) || !['pending', 'answered', 'rejected', 'expired'].includes(state)) throw new Error('Invalid legacy media request')
      db.prepare(`INSERT INTO media_requests(id,session_id,turn_id,kind,state,request_json,result_json,error,created_at,resolved_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, legacyUuid(row, 'session_id'), legacyUuid(row, 'turn_id'), kind,
          state === 'pending' ? 'cancelled' : state === 'answered' ? 'resolved' : state,
          legacyJson(row, 'request_json'), row.result_json === null ? null : legacyJson(row, 'result_json'),
          row.error === null ? (state === 'pending' ? 'Legacy capture interrupted by migration' : null) : legacyText(row, 'error'),
          legacyTime(row.created_at), row.resolved_at === null ? null : legacyTime(row.resolved_at))
      db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run(name, id, id)
      db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run(name, id, preserveLegacyRow(row))
    })
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name=?").run(name)
    db.exec('COMMIT')
    return [name]
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import { tableConverted } from './conversion-state.ts'
import { legacyText, legacyUuid, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'

export async function convertLegacyOperations(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  const name = 'operation_journal'
  if (!source.manifest.tables.some(table => table.name === name)) return []
  if (tableConverted(db, name)) return [name]
  db.exec('BEGIN IMMEDIATE')
  try {
    await source.scan(name, row => {
      const id = legacyText(row, 'operation_id'), state = legacyText(row, 'state')
      if (!id || id.length > 1024) throw new Error('Unsupported legacy operation ID')
      if (!['planned', 'authorized', 'started', 'committed', 'failed', 'unknown'].includes(state)) throw new Error('Invalid legacy operation state')
      const interrupted = state === 'planned' || state === 'authorized'
      const mapped = state === 'started' ? 'unknown' : interrupted ? 'interrupted' : state
      const error = row.error_json === null ? null : legacyJson(row, 'error_json')
      db.prepare(`INSERT INTO tool_operations(id,session_id,turn_id,tool_name,revision,state,result_json,created_at,updated_at,
        request_json,error_json,tool_call_id,capability,resource) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, legacyUuid(row, 'session_id'), legacyUuid(row, 'turn_id'), legacyText(row, 'tool_name'), 'legacy', mapped,
          row.result_json === null ? null : legacyJson(row, 'result_json'), legacyTime(row.created_at), legacyTime(row.updated_at),
          legacyJson(row, 'request_json'), error ?? (interrupted ? JSON.stringify({ code: 'legacy_interrupted', originalState: state }) : null),
          legacyText(row, 'tool_call_id'), legacyText(row, 'capability'), legacyText(row, 'resource'))
      db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run(name, id, id)
      db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run(name, id, preserveLegacyRow(row))
    })
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name=?").run(name)
    db.exec('COMMIT')
    return [name]
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

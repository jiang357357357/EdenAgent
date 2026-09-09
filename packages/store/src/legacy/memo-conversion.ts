import { tableConverted } from './conversion-state.ts'
import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import type { LegacyRow } from './snapshot-format.ts'
import { legacyText, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'

function optionalTime(row: LegacyRow, key: string): number | null {
  if (row[key] === null) return null
  const value = legacyTime(row[key])
  if (value < 0) throw new Error(`Unsupported negative memo timestamp: ${key}`)
  return value
}
function choice(row: LegacyRow, key: string, values: string[]): string {
  const value = legacyText(row, key)
  if (!values.includes(value)) throw new Error(`Invalid legacy memo ${key}`)
  return value
}

/** Preserve snoozing separately from recurrence; scheduling occurs only after full import activation. */
export async function convertLegacyMemos(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  if (!source.manifest.tables.some(table => table.name === 'memos')) return []
  if (tableConverted(db, 'memos')) return ['memos']
  db.exec('BEGIN IMMEDIATE')
  try {
    await source.scan('memos', row => {
      if (typeof row.id !== 'bigint' || row.id < 1n || row.id > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsupported legacy memo ID')
      const session = legacyText(row, 'related_session_id')
      if (session && !db.prepare('SELECT 1 FROM sessions WHERE id=?').get(session)) throw new Error('Legacy memo references an absent session')
      db.prepare(`INSERT INTO memos(id,title,content,kind,status,priority,remind_at,due_at,repeat_rule,related_session_id,
        metadata_json,last_triggered_at,completed_at,created_at,updated_at,snoozed_until,source)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.id, legacyText(row, 'title'), legacyText(row, 'content'),
          choice(row, 'kind', ['note', 'reminder', 'todo']), choice(row, 'status', ['active', 'done', 'archived', 'cancelled']),
          choice(row, 'priority', ['low', 'normal', 'high']), optionalTime(row, 'remind_at'), optionalTime(row, 'due_at'),
          legacyText(row, 'repeat_rule'), session, legacyJson(row, 'metadata_json'), optionalTime(row, 'last_triggered_at'),
          optionalTime(row, 'completed_at'), legacyTime(row.created_at), legacyTime(row.updated_at),
          optionalTime(row, 'snoozed_until'), legacyText(row, 'source'))
      const id = String(row.id)
      db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run('memos', id, id)
      db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run('memos', id, preserveLegacyRow(row))
    })
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name='memos'").run()
    db.exec('COMMIT')
    return ['memos']
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

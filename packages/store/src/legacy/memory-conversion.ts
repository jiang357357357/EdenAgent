import { tableConverted } from './conversion-state.ts'
import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import { legacyText, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'

/** Retain historical memory IDs and scopes without scheduling extraction or remote synchronization. */
export async function convertLegacyMemories(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  if (!source.manifest.tables.some(table => table.name === 'memories')) return []
  if (tableConverted(db, 'memories')) return ['memories']
  db.exec('BEGIN IMMEDIATE')
  try {
    await source.scan('memories', row => {
      if (typeof row.id !== 'bigint' || row.id < 1n || row.id > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Legacy memory ID cannot be represented by the current API')
      }
      const metadata = legacyJson(row, 'metadata_json')
      const value: unknown = JSON.parse(metadata)
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid legacy memory metadata')
      db.prepare(`INSERT INTO memories(id,content,kind,scope_type,scope_key,source_session_id,metadata_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(row.id, legacyText(row, 'content'), legacyText(row, 'kind'),
          legacyText(row, 'scope_type'), legacyText(row, 'scope_key'), legacyText(row, 'source_session_id'),
          metadata, legacyTime(row.created_at), legacyTime(row.updated_at))
      const id = String(row.id)
      db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run('memories', id, id)
      db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run('memories', id, preserveLegacyRow(row))
    })
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name='memories'").run()
    db.exec('COMMIT')
    return ['memories']
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

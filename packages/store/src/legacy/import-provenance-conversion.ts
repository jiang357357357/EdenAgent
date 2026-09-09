import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import type { LegacyRow } from './snapshot-format.ts'
import { legacyText, legacyJson, legacyUuid, legacyTime, preserveLegacyRow } from './fields.ts'
import { tableConverted } from './conversion-state.ts'
function integer(row: LegacyRow, key: string, nonnegative = false): string {
  const value = row[key]
  if (typeof value !== 'bigint' || (nonnegative && value < 0n)) throw new Error(`Invalid historical import integer: ${key}`)
  return String(value)
}
function item(db: DatabaseSync, row: LegacyRow): string {
  const source = legacyText(row, 'source_kind'), entity = legacyText(row, 'entity_kind'), key = legacyText(row, 'legacy_key')
  db.prepare('INSERT INTO legacy_import_items VALUES(?,?,?,?,?,?)').run(source, entity, key, legacyText(row, 'target_key'), legacyJson(row, 'details_json'), legacyTime(row.imported_at))
  return JSON.stringify([source, entity, key])
}
function session(db: DatabaseSync, row: LegacyRow): string {
  const source = legacyText(row, 'source_kind'), key = legacyText(row, 'legacy_session_key')
  db.prepare('INSERT INTO legacy_session_imports VALUES(?,?,?,?,?,?)').run(source, key, legacyUuid(row, 'target_session_id'),
    integer(row, 'legacy_user_id'), integer(row, 'imported_message_count', true), legacyTime(row.imported_at))
  return JSON.stringify([source, key])
}
function skill(db: DatabaseSync, row: LegacyRow): string {
  const id = legacyText(row, 'id'), state = legacyText(row, 'migration_state')
  if (!['requires_reinstall', 'disabled', 'unavailable'].includes(state)) throw new Error('Unsupported historical skill migration state')
  if (row.was_enabled !== 0n && row.was_enabled !== 1n) throw new Error('Invalid historical skill enablement flag')
  db.prepare('INSERT INTO legacy_skill_installations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, legacyText(row, 'legacy_key'),
    legacyText(row, 'skill_name'), legacyText(row, 'display_name'), legacyText(row, 'description'), legacyText(row, 'scope'),
    legacyText(row, 'source_type'), legacyText(row, 'source_uri'), legacyText(row, 'source_ref'), legacyText(row, 'installed_version'),
    legacyText(row, 'content_hash'), Number(row.was_enabled), legacyText(row, 'trust_status'), legacyJson(row, 'manifest_json'), state, legacyTime(row.imported_at))
  return id
}
const domains = [['legacy_import_items', item], ['legacy_session_imports', session], ['legacy_skill_installations', skill]] as const
/** Import provenance stays historical: it cannot grant trust, install code, or re-import a source. */
export async function convertLegacyImportProvenance(db: DatabaseSync, source: LegacySnapshotReader): Promise<void> {
  for (const [name, convert] of domains) {
    if (!source.manifest.tables.some(table => table.name === name) || tableConverted(db, name)) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      await source.scan(name, row => {
        const id = convert(db, row)
        db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run(name, id, preserveLegacyRow(row))
        db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run(name, id, id)
      })
      db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name=?").run(name)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
}

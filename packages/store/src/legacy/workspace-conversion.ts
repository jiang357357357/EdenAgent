import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import { tableConverted } from './conversion-state.ts'
import { legacyText, legacyTime, preserveLegacyRow } from './fields.ts'

/** Restore the saved selection only. Actual file access still goes through WorkspaceService.root validation. */
export async function convertLegacyWorkspace(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  const name = 'workspace_state'
  if (!source.manifest.tables.some(table => table.name === name)) return []
  if (tableConverted(db, name)) return [name]
  db.exec('BEGIN IMMEDIATE')
  try {
    await source.scan(name, row => {
      if (row.singleton !== 1n) throw new Error('Invalid legacy workspace singleton')
      const current = legacyText(row, 'current_path'), at = legacyTime(row.updated_at)
      if (current.includes('\0') || current.length > 32768) throw new Error('Invalid legacy workspace path')
      const compatible = current !== '' && path.isAbsolute(current)
      if (compatible) db.prepare('INSERT INTO runtime_settings(key,value_json,updated_at) VALUES(?,?,?)')
        .run('workspace.root', JSON.stringify(current), at)
      db.prepare('INSERT INTO runtime_settings(key,value_json,updated_at) VALUES(?,?,?)').run('workspace.legacy_import',
        JSON.stringify({ currentPath: current, state: compatible ? 'selected_unvalidated' : 'reselection_required',
          pendingPath: row.pending_path === null ? null : legacyText(row, 'pending_path'),
          pendingSessionId: row.pending_session_id === null ? null : legacyText(row, 'pending_session_id'),
          requestedAt: row.requested_at === null ? null : legacyTime(row.requested_at),
          pendingState: row.pending_path === null ? 'none' : 'interrupted' }), at)
      db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run(name, '1', 'workspace.root')
      db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run(name, '1', preserveLegacyRow(row))
    })
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name=?").run(name)
    db.exec('COMMIT')
    return [name]
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

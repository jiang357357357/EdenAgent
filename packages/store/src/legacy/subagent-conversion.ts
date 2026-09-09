import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import { legacyRow } from './snapshot-format.ts'
import { legacyUuid, preserveLegacyRow } from './fields.ts'
import { tableConverted } from './conversion-state.ts'
import { convertLegacyThread } from './subagent-thread.ts'

/** Stage on disk, then convert parents before children; reject orphans and cycles as one table transaction. */
export async function convertLegacySubagents(db: DatabaseSync, source: LegacySnapshotReader): Promise<void> {
  if (!source.manifest.tables.some(table => table.name === 'agent_threads') || tableConverted(db, 'agent_threads')) return
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec('CREATE TEMP TABLE legacy_agent_staging(id TEXT PRIMARY KEY,parent_id TEXT,row_json TEXT NOT NULL)')
    await source.scan('agent_threads', row => {
      const id = legacyUuid(row, 'id'), preserved = preserveLegacyRow(row)
      db.prepare('INSERT INTO legacy_agent_staging VALUES(?,?,?)').run(id, row.parent_id === null ? null : legacyUuid(row, 'parent_id'), preserved)
      db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run('agent_threads', id, preserved)
    })
    while (true) {
      const ready = db.prepare(`SELECT s.id,s.row_json FROM legacy_agent_staging s WHERE s.parent_id IS NULL
        OR EXISTS(SELECT 1 FROM subagent_threads p WHERE p.id=s.parent_id) ORDER BY s.id LIMIT 256`).all()
      if (!ready.length) break
      for (const item of ready) {
        convertLegacyThread(db, legacyRow(JSON.parse(String(item.row_json))))
        db.prepare('DELETE FROM legacy_agent_staging WHERE id=?').run(item.id!)
      }
    }
    if (db.prepare('SELECT 1 FROM legacy_agent_staging LIMIT 1').get()) throw new Error('Historical subagent tree contains missing parents or cycles')
    db.exec('DROP TABLE legacy_agent_staging')
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name='agent_threads'").run()
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

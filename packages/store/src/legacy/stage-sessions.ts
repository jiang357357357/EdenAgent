import { mkdir, open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { EdenDatabase } from '../database.ts'
import { LegacySnapshotReader } from './snapshot-reader.ts'
import { runLegacyConversion } from './conversion-runner.ts'

export async function stageLegacySessions(snapshot: string, destination: string, origin: 'mon' | 'local', blobSourceRoot?: string) {
  const source = await LegacySnapshotReader.open(snapshot, origin)
  const target = path.resolve(destination)
  await mkdir(target, { mode: 0o700 })
  const lockPath = path.join(target, '.conversion.lock')
  const lock = await open(lockPath, 'wx', 0o600)
  try {
  const database = new EdenDatabase(path.join(target, 'agent.sqlite'), origin)
  try {
    database.transaction(() => {
      database.connection.prepare("INSERT INTO realm_meta VALUES ('legacy_import_state','incomplete')").run()
      database.connection.exec(`CREATE TABLE legacy_conversion_ids(domain TEXT NOT NULL,source_id TEXT NOT NULL,target_id TEXT NOT NULL,PRIMARY KEY(domain,source_id));
        CREATE TABLE legacy_conversion_tables(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,rows INTEGER NOT NULL,state TEXT NOT NULL);
        CREATE TABLE legacy_conversion_records(domain TEXT NOT NULL,source_id TEXT NOT NULL,row_json TEXT NOT NULL,PRIMARY KEY(domain,source_id));`)
      for (const table of source.manifest.tables) database.connection.prepare('INSERT INTO legacy_conversion_tables VALUES(?,?,?,?)').run(table.name, table.sha256, table.rows, 'pending')
    })
    return await runLegacyConversion(database.connection, source, target, origin, blobSourceRoot)
  } finally { database.close() }
  } finally { await lock.close(); await unlink(lockPath) }
}

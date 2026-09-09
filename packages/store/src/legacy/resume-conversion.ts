import { DatabaseSync } from 'node:sqlite'
import { lstat, realpath, open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { migrateDatabase } from '../migrations.ts'
import { LegacySnapshotReader } from './snapshot-reader.ts'
import { runLegacyConversion } from './conversion-runner.ts'
import { assertStagingMutable } from './activation-guard.ts'

/** Explicit importer connection; the ordinary host keeps rejecting incomplete databases. */
export async function resumeLegacyConversion(snapshot: string, destination: string, origin: 'mon' | 'local', blobSourceRoot?: string, pluginVersionsRoot?: string) {
  const source = await LegacySnapshotReader.open(snapshot, origin), target = await realpath(destination)
  const filename = path.join(target, 'agent.sqlite'), info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Conversion database must be a regular file')
  const lockPath = path.join(target, '.conversion.lock')
  const lock = await open(lockPath, 'wx', 0o600)
  let db: DatabaseSync | undefined
  try {
    await lock.writeFile('Explicit migration in progress. After a crash, confirm the importer has stopped before removing this lock.\n')
    await lock.sync()
    assertStagingMutable(target)
    db = new DatabaseSync(filename)
    const realm = db.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()
    const state = db.prepare("SELECT value FROM realm_meta WHERE key='legacy_import_state'").get()
    if (realm?.value !== origin || state?.value !== 'incomplete') throw new Error('Only an incomplete import in the same world may resume')
    const tables = db.prepare('SELECT name,sha256,rows,state FROM legacy_conversion_tables').all()
    if (tables.length !== source.manifest.tables.length) throw new Error('Resume snapshot table set changed')
    for (const table of source.manifest.tables) {
      const prior = tables.find(row => row.name === table.name)
      if (!prior || prior.sha256 !== table.sha256 || Number(prior.rows) !== table.rows || !['pending', 'converted'].includes(String(prior.state))) {
        throw new Error(`Resume snapshot differs for table: ${table.name}`)
      }
    }
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA journal_mode=WAL;')
    migrateDatabase(db)
    return await runLegacyConversion(db, source, target, origin, blobSourceRoot, pluginVersionsRoot)
  } finally {
    try { db?.close() } finally { await lock.close(); await unlink(lockPath) }
  }
}

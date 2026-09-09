import { DatabaseSync } from 'node:sqlite'
import { lstat, realpath, open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { migrateDatabase } from '../migrations.ts'
import { assertStagingMutable } from './activation-guard.ts'

/** Offline recovery shares the importer lock and never opens an activated realm. */
export async function withLegacyRecovery<T>(destination: string, origin: 'mon' | 'local', operation: (db: DatabaseSync, target: string) => Promise<T>): Promise<T> {
  const target = await realpath(destination), filename = path.join(target, 'agent.sqlite')
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Conversion database must be a regular file')
  const lockPath = path.join(target, '.conversion.lock'), lock = await open(lockPath, 'wx', 0o600)
  let db: DatabaseSync | undefined
  try {
    await lock.writeFile('Explicit offline recovery in progress. Confirm the process has stopped before removing a stale lock.\n')
    await lock.sync()
    assertStagingMutable(target)
    db = new DatabaseSync(filename)
    if (db.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== origin ||
        db.prepare("SELECT value FROM realm_meta WHERE key='legacy_import_state'").get()?.value !== 'incomplete') {
      throw new Error('Recovery requires an incomplete import in the selected world')
    }
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA journal_mode=WAL;')
    migrateDatabase(db)
    return await operation(db, target)
  } finally {
    try { db?.close() } finally { await lock.close(); await unlink(lockPath) }
  }
}

import { DatabaseSync } from 'node:sqlite'
import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { conversionReport } from './conversion-report.ts'

/** Read committed progress directly; this neither migrates schema nor trusts a stale JSON report. */
export async function readLegacyConversionStatus(destination: string, origin: 'mon' | 'local') {
  const target = await realpath(destination), filename = path.join(target, 'agent.sqlite')
  const info = await lstat(filename)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Conversion database must be a regular file')
  const db = new DatabaseSync(filename, { readOnly: true })
  try {
    db.exec('PRAGMA query_only=ON; BEGIN;')
    if (db.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== origin) throw new Error('Conversion world mismatch')
    const state = db.prepare("SELECT value FROM realm_meta WHERE key='legacy_import_state'").get()?.value
    if (state !== 'incomplete') throw new Error('This is not an incomplete conversion database')
    const report = conversionReport(db, origin, 'status')
    db.exec('COMMIT')
    return report
  } finally { db.close() }
}

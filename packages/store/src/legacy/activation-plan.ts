import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, realpath, open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { LegacySnapshotReader } from './snapshot-reader.ts'
import { legacyRecoverySummary } from './recovery-summary.ts'
import { databaseSchemaVersion } from '../migrations.ts'

/** Lock ordering matches the host: process ownership before importer/reviewer ownership. */
export async function withActivationLock<T>(destination: string, operation: (target: string) => Promise<T>): Promise<T> {
  const target = await realpath(destination)
  const owner = new DatabaseSync(path.join(target, 'runtime-lock.db'))
  let locked = false
  try {
    owner.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE')
    locked = true
    const lockPath = path.join(target, '.conversion.lock'), lock = await open(lockPath, 'wx', 0o600)
    try {
      await lock.writeFile('Offline activation planning. Confirm the process has stopped before removing this lock.\n')
      await lock.sync()
      return await operation(target)
    } finally { await lock.close(); await unlink(lockPath) }
  } finally { try { if (locked) owner.exec('ROLLBACK') } finally { owner.close() } }
}

async function digestFile(filename: string, optional = false): Promise<string | null> {
  let info
  try { info = await lstat(filename) }
  catch (error) { if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Activation evidence must be regular files')
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(filename)) digest.update(chunk)
  const after = await lstat(filename)
  if (info.size !== after.size || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs) throw new Error('Activation evidence changed during inspection')
  return digest.digest('hex')
}

/** Caller owns both locks. Read committed source facts; never use a cached report as a gate. */
export async function buildActivationPlan(snapshot: string, target: string, origin: 'mon' | 'local') {
  const source = await LegacySnapshotReader.open(snapshot, origin)
  const filename = path.join(target, 'agent.sqlite')
  await digestFile(filename)
  const existingRuntime = await digestFile(path.join(target, 'eden-agent.db'), true)
  const db = new DatabaseSync(filename, { readOnly: true })
  try {
    db.exec('PRAGMA query_only=ON; BEGIN;')
    if (db.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== origin ||
      db.prepare("SELECT value FROM realm_meta WHERE key='legacy_import_state'").get()?.value !== 'incomplete') throw new Error('Activation planning requires an incomplete staging database in the selected world')
    const tables = db.prepare('SELECT name,sha256,rows,state FROM legacy_conversion_tables ORDER BY name').all()
    const blockers: string[] = []
    if (existingRuntime !== null) blockers.push('A runtime database already exists; never overwrite it during activation')
    if (tables.length !== source.manifest.tables.length) blockers.push('Snapshot and staged table sets differ')
    for (const table of source.manifest.tables) {
      await source.scan(table.name, () => {})
      const staged = tables.find(row => row.name === table.name)
      if (!staged || staged.sha256 !== table.sha256 || Number(staged.rows) !== table.rows) blockers.push(`Snapshot evidence differs: ${table.name}`)
      if (staged?.state !== 'converted') blockers.push(`Table conversion pending: ${table.name}`)
    }
    const recovery = legacyRecoverySummary(db)
    for (const domain of recovery.items) if (domain.count) blockers.push(`Recovery pending: ${domain.key} (${domain.count})`)
    if (recovery.workspaceSelection !== 'not_imported' && recovery.workspaceSelection !== 'reselected') blockers.push(`Workspace selection requires review: ${recovery.workspaceSelection}`)
    const activeInputs = Number(db.prepare("SELECT COUNT(*) AS count FROM inputs WHERE state IN ('queued','running')").get()?.count)
    const activeJobs = Number(db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE state IN ('queued','running','dispatched')").get()?.count)
    if (activeInputs) blockers.push(`Unsettled runnable inputs: ${activeInputs}`)
    if (activeJobs) blockers.push(`Unsettled runnable jobs: ${activeJobs}`)
    const foreignKeyViolation = Boolean(db.prepare('PRAGMA foreign_key_check').get())
    if (foreignKeyViolation) blockers.push('Foreign-key integrity requires repair')
    const integrity = db.prepare('PRAGMA integrity_check').all().map(row => String(row.integrity_check))
    if (integrity.length !== 1 || integrity[0] !== 'ok') blockers.push('SQLite integrity requires repair')
    const schemaVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version)
    if (schemaVersion !== databaseSchemaVersion) blockers.push('Staging schema differs from this host; resume schema preparation before activation')
    for (const blob of db.prepare('SELECT id,sha256,byte_length FROM blobs ORDER BY id').iterate()) {
      const hash = String(blob.sha256)
      if (!/^[a-f0-9]{64}$/.test(hash)) { blockers.push(`Invalid Blob digest: ${String(blob.id)}`); continue }
      try {
        const root = path.join(target, 'blobs'), prefix = path.join(root, hash.slice(0, 2))
        if ((await lstat(root)).isSymbolicLink() || (await lstat(prefix)).isSymbolicLink()) throw new Error('Unsafe Blob directory')
        const filename = path.join(prefix, hash), info = await lstat(filename)
        if (info.size !== Number(blob.byte_length) || await digestFile(filename) !== hash) throw new Error('Blob content differs from metadata')
      } catch (error) { blockers.push(`Blob unavailable or invalid: ${String(blob.id)} (${error instanceof Error ? error.message : String(error)})`) }
    }
    db.exec('COMMIT')
    const evidence = { origin, target, schemaVersion, tables, databaseSha256: await digestFile(filename),
      walSha256: await digestFile(`${filename}-wal`, true), recovery, blockers }
    return { format: 'eden.activation-plan.v1', fingerprint: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
      ...evidence, sourceDatabase: filename, runtimeDatabase: path.join(target, 'eden-agent.db'),
      state: 'review_required',
      note: 'Offline data preflight only. Even zero blockers do not prove business compatibility or authorize activation. Preserve the staging root and its assets; explicit activation and rollback are separate operations.' }
  } finally { db.close() }
}

export function readActivationPlan(snapshot: string, destination: string, origin: 'mon' | 'local') {
  return withActivationLock(destination, target => buildActivationPlan(snapshot, target, origin))
}

import { open, realpath, lstat, mkdir, rename, unlink, link } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import selectionReader from '../../frontend/desktop/src/processes/runtime-selection.cjs'
import realmResolver from '../../frontend/desktop/src/processes/realm-data-roots.cjs'
import { withActivationLock } from '../../packages/store/src/legacy/activation-plan.ts'
import { syncActivationDirectory } from '../../packages/store/src/legacy/activation.ts'
import { assertPublicationGroup } from '../../packages/store/src/legacy/publication-group.ts'

function readOptional(filename) {
  try { return selectionReader.readRuntimeSelection(filename) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

async function writeNew(filename, value) {
  const file = await open(filename, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync() }
  finally { await file.close() }
}

async function preserveHistory(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`
  try {
    await writeNew(temporary, value)
    try { await link(temporary, filename) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (JSON.stringify(selectionReader.readRuntimeSelection(filename)) !== JSON.stringify(value)) throw new Error('Selection history conflicts with the current revision')
    }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

function assertRuntime(root, origin) {
  const database = new DatabaseSync(path.join(root, 'eden-agent.db'), { readOnly: true })
  try {
    if (database.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== origin) throw new Error('Selected database belongs to a different world')
    const state = database.prepare("SELECT value FROM realm_meta WHERE key='legacy_import_state'").get()?.value
    if (state !== undefined && state !== 'complete') throw new Error('Selected database is not active; finish migration or choose another runtime')
    assertPublicationGroup(database, path.join(root, 'eden-agent.db'), origin)
  } finally { database.close() }
}

/** A single durable selection replaces both roots; all old/new realm processes must be stopped. */
export async function selectRuntimeRoots(filename, expectedRevision, proposedRoots, note) {
  if (!path.isAbsolute(filename) || typeof note !== 'string' || !note.trim() || note.length > 4000) throw new Error('Selection requires absolute filename and a nonempty note of at most 4000 characters')
  const directory = await realpath(path.dirname(filename))
  filename = path.join(directory, path.basename(filename))
  const lockPath = `${filename}.lock`, lock = await open(lockPath, 'wx', 0o600)
  try {
    await lock.writeFile('Offline dual-world selection. Confirm this process stopped before removing a stale lock.\n'); await lock.sync()
    const prior = readOptional(filename)
    if ((prior?.revision ?? 'none') !== expectedRevision) throw new Error('Runtime selection changed; reload its revision')
    const roots = {}
    for (const origin of ['mon', 'local']) roots[origin] = await realpath(proposedRoots[origin])
    realmResolver.resolveRealmDataRoots({}, roots)
    const affected = [...new Set(await Promise.all([...Object.values(roots), ...Object.values(prior?.roots ?? {})].map(value => realpath(value))))].sort()
    async function locked(index, operation) {
      if (index === affected.length) return operation()
      return withActivationLock(affected[index], () => locked(index + 1, operation))
    }
    return await locked(0, async () => {
      for (const origin of ['mon', 'local']) {
        const file = await lstat(path.join(roots[origin], 'eden-agent.db'))
        if (!file.isFile() || file.isSymbolicLink()) throw new Error('Selected runtime database must be regular')
        assertRuntime(roots[origin], origin)
      }
      const history = `${filename}.history`
      await mkdir(history, { recursive: true, mode: 0o700 })
      if ((await lstat(history)).isSymbolicLink()) throw new Error('Selection history cannot be a symlink')
      if (prior) {
        const previousFile = path.join(history, `${prior.revision}.json`)
        await preserveHistory(previousFile, prior)
      }
      const value = { format: 'eden.runtime-selection.v1', revision: randomUUID(), roots,
        previousRevision: prior?.revision ?? null, note: note.trim(), createdAt: Date.now() }
      const temporary = path.join(directory, `.runtime-selection-${value.revision}.json`)
      try {
        await writeNew(temporary, value)
        await syncActivationDirectory(history)
        await rename(temporary, filename)
        await syncActivationDirectory(directory)
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
      return value
    })
  } finally { await lock.close(); await unlink(lockPath) }
}

export async function restoreRuntimeSelection(filename, expectedRevision, note) {
  const current = selectionReader.readRuntimeSelection(filename)
  if (current.revision !== expectedRevision || !current.previousRevision) throw new Error('No matching previous runtime selection')
  const previous = selectionReader.readRuntimeSelection(path.join(`${filename}.history`, `${current.previousRevision}.json`))
  return selectRuntimeRoots(filename, expectedRevision, previous.roots, note)
}

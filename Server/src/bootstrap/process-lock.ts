import { mkdirSync, chmodSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

/** Separate SQLite file: kernel locks are released on crashes, with no stale-file deletion. */
export function acquireProcessLock(dataRoot: string): () => void {
  mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
  const filename = path.join(dataRoot, 'runtime-lock.db')
  const owner = new DatabaseSync(filename)
  try {
    if (process.platform !== 'win32') chmodSync(filename, 0o600)
    owner.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE')
  } catch (error) {
    owner.close()
    throw new Error('Runtime data is locked or its ownership lock is unavailable', { cause: error })
  }
  let released = false
  return () => {
    if (released) return
    released = true
    try { owner.exec('ROLLBACK') }
    finally { owner.close() }
  }
}

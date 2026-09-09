import { constants } from 'node:fs'
import { open, realpath, lstat, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import type { LegacyRow } from './snapshot-format.ts'

async function sourceFile(root: string, storagePath: string) {
  const parts = storagePath.split(/[\\/]/)
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part))) throw new Error('Unsafe legacy Blob path')
  let current = root
  for (const part of parts) { current = path.join(current, part); if ((await lstat(current)).isSymbolicLink()) throw new Error('Legacy Blob path contains a symlink') }
  const resolved = await realpath(current)
  if (!resolved.startsWith(root + path.sep)) throw new Error('Legacy Blob escapes its root')
  return open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
}
async function copyBlob(row: LegacyRow, root: string, target: string, maxBytes: number) {
  const id = row.id, hash = row.sha256, mime = row.mime
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || typeof mime !== 'string' || !/^[\x20-\x7e]{1,255}$/.test(mime)
    || typeof row.storage_path !== 'string' || typeof row.byte_length !== 'bigint' || row.byte_length < 0n || row.byte_length > BigInt(maxBytes)
    || typeof row.created_at !== 'bigint' || row.created_at < 0n || !Number.isSafeInteger(Number(row.created_at))) throw new Error('Invalid or oversized legacy Blob metadata')
  const source = await sourceFile(root, row.storage_path)
  try {
    const initial = await source.stat()
    if (!initial.isFile() || initial.size !== Number(row.byte_length)) throw new Error('Legacy Blob size mismatch')
    const directory = path.join(target, hash.slice(0, 2))
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if ((await lstat(directory)).isSymbolicLink()) throw new Error('Unsafe target Blob directory')
    const output = await open(path.join(directory, hash), 'wx', 0o600)
    try {
      const buffer = Buffer.alloc(65536), digest = createHash('sha256')
      let position = 0
      while (true) {
        const { bytesRead } = await source.read(buffer, 0, buffer.length, position)
        if (!bytesRead) break
        position += bytesRead
        if (position > initial.size) throw new Error('Legacy Blob grew during copy')
        const bytes = buffer.subarray(0, bytesRead)
        digest.update(bytes); await output.writeFile(bytes)
      }
      const final = await source.stat()
      if (position !== initial.size || digest.digest('hex') !== hash || final.mtimeMs !== initial.mtimeMs || final.ctimeMs !== initial.ctimeMs) throw new Error('Legacy Blob integrity mismatch')
      await output.sync()
      if (process.platform !== 'win32') {
        const parent = await open(directory, constants.O_RDONLY)
        try { await parent.sync() } finally { await parent.close() }
      }
    } finally { await output.close() }
  } finally { await source.close() }
  return { id, hash, mime, bytes: row.byte_length, createdAt: row.created_at }
}
export async function convertLegacyBlobs(db: DatabaseSync, snapshot: LegacySnapshotReader, sourceRoot: string, targetRoot: string, maxBytes = 32 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024 * 1024) throw new Error('Invalid migration Blob size limit')
  const root = await realpath(sourceRoot), target = path.resolve(targetRoot)
  if (target === root || target.startsWith(root + path.sep) || root.startsWith(target + path.sep)) throw new Error('Blob source and target must be separate')
  await mkdir(target, { mode: 0o700 })
  db.exec('BEGIN IMMEDIATE')
  try {
    await snapshot.scan('blobs', async row => {
      const blob = await copyBlob(row, root, target, maxBytes)
      db.prepare('INSERT INTO blobs(id,sha256,mime,byte_length,created_at) VALUES(?,?,?,?,?)').run(blob.id, blob.hash, blob.mime, blob.bytes, blob.createdAt)
      db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run('blobs', blob.id, blob.id)
    })
    if (process.platform !== 'win32') {
      const directory = await open(target, constants.O_RDONLY)
      try { await directory.sync() } finally { await directory.close() }
    }
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name='blobs'").run()
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

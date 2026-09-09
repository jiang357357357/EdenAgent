import { open, realpath, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { legacyManifest, legacyRow } from './snapshot-format.ts'
import type { LegacyManifest, LegacyRow } from './snapshot-format.ts'

async function assertComplete(root: string) {
  try { await lstat(path.join(root, 'INCOMPLETE')) }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return; throw error }
  throw new Error('Legacy snapshot is incomplete')
}
async function regularFile(root: string, filename: string) {
  const full = path.join(root, filename)
  if ((await lstat(full)).isSymbolicLink()) throw new Error('Snapshot files cannot be symlinks')
  const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  if (!(await handle.stat()).isFile()) { await handle.close(); throw new Error('Snapshot entry is not a regular file') }
  return handle
}
export class LegacySnapshotReader {
  private constructor(readonly root: string, readonly manifest: LegacyManifest) {}
  static async open(directory: string, origin: 'mon' | 'local') {
    const root = await realpath(directory)
    await assertComplete(root)
    const handle = await regularFile(root, 'manifest.json')
    let manifest: LegacyManifest
    try {
      if ((await handle.stat()).size > 16 * 1024 * 1024) throw new Error('Legacy manifest is too large')
      const bytes = Buffer.alloc(16 * 1024 * 1024 + 1)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      if (bytesRead > 16 * 1024 * 1024) throw new Error('Legacy manifest grew beyond the size limit')
      manifest = legacyManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))))
    } finally { await handle.close() }
    if (manifest.origin !== origin) throw new Error('Legacy snapshot world mismatch')
    for (const table of manifest.tables) Object.freeze(table)
    Object.freeze(manifest.tables); Object.freeze(manifest)
    return new LegacySnapshotReader(root, manifest)
  }

  /** Consumers write only into staging. Do not commit an import until every scan has resolved successfully. */
  async scan(name: string, consume: (row: LegacyRow, index: number) => void | Promise<void>): Promise<void> {
    await assertComplete(this.root)
    const table = this.manifest.tables.find(item => item.name === name)
    if (!table) throw new Error(`Legacy table is absent: ${name}`)
    const handle = await regularFile(this.root, table.file)
    try {
      const initial = await handle.stat()
      if (initial.size !== table.bytes) throw new Error(`Legacy table size mismatch: ${name}`)
      const hash = createHash('sha256'), buffer = Buffer.alloc(65536)
      let remainder = Buffer.alloc(0), rows = 0, position = 0
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
        if (!bytesRead) break
        position += bytesRead
        if (position > table.bytes) throw new Error(`Legacy table grew during reading: ${name}`)
        const chunk = buffer.subarray(0, bytesRead); hash.update(chunk)
        remainder = Buffer.concat([remainder, chunk])
        let newline: number
        while ((newline = remainder.indexOf(10)) !== -1) {
          if (newline > 32 * 1024 * 1024) throw new Error('Legacy row is too large')
          const line = new TextDecoder('utf-8', { fatal: true }).decode(remainder.subarray(0, newline))
          remainder = remainder.subarray(newline + 1)
          if (++rows > table.rows) throw new Error(`Legacy table row count mismatch: ${name}`)
          await consume(legacyRow(JSON.parse(line)), rows - 1)
        }
        if (remainder.length > 32 * 1024 * 1024) throw new Error('Legacy row is too large')
      }
      const final = await handle.stat()
      if (remainder.length || rows !== table.rows || position !== table.bytes || hash.digest('hex') !== table.sha256
        || initial.mtimeMs !== final.mtimeMs || initial.ctimeMs !== final.ctimeMs) throw new Error(`Legacy table integrity mismatch: ${name}`)
      await assertComplete(this.root)
    } finally { await handle.close() }
  }
}

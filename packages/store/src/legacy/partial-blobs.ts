import { lstat, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
export async function preservePartialBlobs(target: string): Promise<void> {
  const directory = path.join(target, 'blobs')
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Partial blob target is not an owned directory')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  await rename(directory, path.join(target, `blobs-incomplete-${randomUUID()}`))
}

import { constants } from 'node:fs'
import { mkdir, lstat, open, link, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

export function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function directory(dirname: string): Promise<void> {
  await mkdir(dirname, { recursive: true, mode: 0o700 })
  const stat = await lstat(dirname)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe blob directory')
}

async function syncDirectory(dirname: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(dirname, constants.O_RDONLY)
  try { await handle.sync() } finally { await handle.close() }
}

export class BlobFiles {
  constructor(private readonly root: string, private readonly maxBytes: number) {}

  private async filename(hash: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid blob hash')
    await directory(this.root)
    await syncDirectory(path.dirname(this.root))
    const parent = path.join(this.root, hash.slice(0, 2))
    await directory(parent)
    await syncDirectory(this.root)
    return path.join(parent, hash)
  }

  async read(hash: string, expectedBytes: number): Promise<Buffer> {
    const filename = await this.filename(hash)
    const stat = await lstat(filename)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe blob file')
    const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.size !== expectedBytes || opened.size > this.maxBytes) throw new Error('Blob size integrity failure')
      const bytes = Buffer.alloc(expectedBytes + 1)
      let offset = 0
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (!result.bytesRead) break
        offset += result.bytesRead
      }
      const content = bytes.subarray(0, offset)
      if (offset !== expectedBytes || digest(content) !== hash) throw new Error('Blob content integrity failure')
      return content
    } finally { await handle.close() }
  }

  async put(hash: string, bytes: Buffer): Promise<void> {
    const filename = await this.filename(hash)
    const temporary = `${filename}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try {
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      try { await link(temporary, filename) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await this.read(hash, bytes.length)
      }
      await syncDirectory(path.dirname(filename))
    } finally { await unlink(temporary) }
  }
}

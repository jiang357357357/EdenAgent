import { constants } from 'node:fs'
import { open, mkdtemp, rm, chmod } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
/** Freeze the exact approved bytes into a private, read-only launch copy. */
export async function snapshotWorker(source: string, expected: string, signal: AbortSignal) {
  signal.throwIfAborted()
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid worker digest')
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
  let directory: string | undefined
  try {
    const before = await input.stat()
    if (!before.isFile() || before.size < 1 || before.size > 128 * 1024 * 1024) throw new Error('Worker snapshot size is invalid')
    directory = await mkdtemp(path.join(tmpdir(), 'eden-worker-'))
    const executable = path.join(directory, 'worker')
    const output = await open(executable, 'wx', 0o600)
    const hash = createHash('sha256'), buffer = Buffer.alloc(65536)
    try {
      let offset = 0
      while (offset < before.size) {
        signal.throwIfAborted()
        const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset)
        if (!bytesRead) throw new Error('Worker snapshot source was truncated')
        hash.update(buffer.subarray(0, bytesRead))
        let written = 0
        while (written < bytesRead) {
          const result = await output.write(buffer, written, bytesRead - written, offset + written)
          if (!result.bytesWritten) throw new Error('Worker snapshot write made no progress')
          written += result.bytesWritten
        }
        offset += bytesRead
      }
      const after = await input.stat()
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || hash.digest('hex') !== expected) throw new Error('Worker bytes differ from the approved artifact')
      await output.sync()
    } finally { await output.close() }
    await chmod(executable, 0o500)
    signal.throwIfAborted()
    const root = directory
    return { executable, async cleanup() { await rm(root, { recursive: true, force: true }) } }
  } catch (error) { if (directory) await rm(directory, { recursive: true, force: true }); throw error }
  finally { await input.close() }
}

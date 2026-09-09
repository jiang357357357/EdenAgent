import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
function relative(name: string): string {
  if (!name || name.length > 4096 || name.startsWith('/') || /[\\:\x00-\x1f]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Worker package path is unsafe')
  return name
}
export async function snapshotWorkerPackage(files: ReadonlyMap<string, Buffer>, entrypoint: string, expected: string, signal: AbortSignal) {
  signal.throwIfAborted(); relative(entrypoint)
  const executable = files.get(entrypoint)
  if (!executable?.length || !/^[a-f0-9]{64}$/.test(expected) || createHash('sha256').update(executable).digest('hex') !== expected) throw new Error('Native worker package executable differs from the approved digest')
  if (files.size > 520) throw new Error('Worker package exceeds file count limit')
  const root = await mkdtemp(path.join(tmpdir(), 'eden-worker-package-'))
  try {
    let total = 0
    for (const [name, bytes] of files) {
      signal.throwIfAborted(); relative(name)
      if (name.split('/').length > 17 || (total += bytes.length) > 64 * 1024 * 1024) throw new Error('Worker package exceeds snapshot limits')
      const target = path.join(root, name)
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
      const file = await open(target, 'wx', 0o500)
      try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    }
    signal.throwIfAborted()
    return { root, executable: path.join(root, entrypoint), guestExecutable: `/package/${entrypoint}`, cwd: '/package', async cleanup() { await rm(root, { recursive: true, force: true }) } }
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error }
}

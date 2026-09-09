import { constants } from 'node:fs'
import { lstat, realpath, readdir, open, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
export async function legacyPluginSource(root: string, segments: string[]): Promise<string> {
  let current = root
  for (const part of segments) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/.test(part) || part === '.' || part === '..') throw new Error('Unsafe historical plugin directory segment')
    current = path.join(current, part)
    const stat = await lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Historical plugin directory is missing or contains links')
  }
  const canonical = await realpath(current)
  if (!canonical.startsWith(root + path.sep)) throw new Error('Historical plugin escapes supplied versions root')
  return canonical
}

/** Copy bytes only; snapshots cannot authorize code execution or select arbitrary root_path values. */
export async function copyLegacyPluginTree(source: string, target: string) {
  const files: Record<string, { bytes: number; sha256: string }> = Object.create(null)
  let total = 0, entries = 0
  const visit = async (directory: string, output: string, relative: string, depth: number): Promise<void> => {
    if (depth > 16) throw new Error('Historical plugin exceeds directory depth limit')
    const before = await lstat(directory), canonical = await realpath(directory)
    if (!before.isDirectory() || before.isSymbolicLink() || (canonical !== source && !canonical.startsWith(source + path.sep))) throw new Error('Unsafe historical plugin directory')
    await mkdir(output, { mode: 0o700 })
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++entries > 1024 || /[\\:\x00-\x1f]/.test(entry.name)) throw new Error('Historical plugin exceeds entry limit or contains unsafe names')
      const filename = path.join(directory, entry.name), destination = path.join(output, entry.name), name = relative + entry.name
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error('Historical plugin contains links or special files')
      if (entry.isDirectory()) { await visit(filename, destination, name + '/', depth + 1); continue }
      if (Object.keys(files).length >= 520) throw new Error('Historical plugin exceeds file limit')
      const input = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const start = await input.stat(), resolved = await realpath(filename)
        if (!start.isFile() || !resolved.startsWith(source + path.sep) || start.size + total > 64 * 1024 * 1024) throw new Error('Historical plugin file is unsafe or exceeds 64 MiB')
        const outputFile = await open(destination, 'wx', 0o600)
        try {
          const digest = createHash('sha256'), buffer = Buffer.alloc(65536)
          let size = 0
          while (true) {
            const { bytesRead } = await input.read(buffer, 0, buffer.length, size)
            if (!bytesRead) break
            size += bytesRead
            if (size > start.size) throw new Error('Historical plugin grew during copy')
            digest.update(buffer.subarray(0, bytesRead)); await outputFile.writeFile(buffer.subarray(0, bytesRead))
          }
          const end = await input.stat()
          if (size !== start.size || start.mtimeMs !== end.mtimeMs || start.ctimeMs !== end.ctimeMs) throw new Error('Historical plugin changed during copy')
          await outputFile.sync(); total += size
          files[name] = { bytes: size, sha256: digest.digest('hex') }
        } finally { await outputFile.close() }
      } finally { await input.close() }
    }
    const after = await lstat(directory)
    if (after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.ino !== before.ino) throw new Error('Historical plugin directory changed during copy')
    await syncDirectory(output)
  }
  await visit(source, target, '', 0)
  return { files, totalBytes: total }
}

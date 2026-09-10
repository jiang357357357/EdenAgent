import { constants } from 'node:fs'
import { realpath, readdir, open } from 'node:fs/promises'
import path from 'node:path'
export async function localPackageFiles(source: string, signal: AbortSignal, includeGit = false) {
  const root = await realpath(source), files = new Map<string, Buffer>()
  let total = 0
  async function visit(directory: string, prefix: string, depth: number): Promise<void> {
    signal.throwIfAborted()
    const canonical = await realpath(directory)
    if (canonical !== root && !canonical.startsWith(root + path.sep)) throw new Error('Plugin directory escapes source root')
    if (depth > 16) throw new Error('Plugin directory nesting exceeds limit')
    const entries = await readdir(directory, { withFileTypes: true })
    if (entries.length > 520) throw new Error('Plugin directory exceeds entry limit')
    for (const entry of entries) {
      signal.throwIfAborted()
      if (entry.name === '.git' && !includeGit) continue
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error('Plugin cannot contain links or special files')
      const filename = path.join(directory, entry.name), relative = prefix + entry.name
      if (entry.isDirectory()) { await visit(filename, relative + '/', depth + 1); continue }
      if (files.size >= 520) throw new Error('Plugin package exceeds file count limit')
      total = await readPackageFile(filename, root, total, files, relative)
    }
  }
  await visit(root, '', 0)
  return { root, files }
}

async function readPackageFile(filename: string, root: string, total: number, files: Map<string, Buffer<ArrayBufferLike>>, relative: string) {
  const canonicalFile = await realpath(filename)
  if (!canonicalFile.startsWith(root + path.sep)) throw new Error('Plugin file escapes source root')
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024 || total + stat.size > 64 * 1024 * 1024) throw new Error('Plugin package exceeds 64 MiB')
    const bytes = Buffer.alloc(Number(stat.size) + 1)
    let offset = 0
    while (offset < bytes.length) { const read = await handle.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead }
    if (offset !== stat.size || (await handle.stat()).mtimeMs !== stat.mtimeMs) throw new Error('Plugin file changed during preview')
    total += offset; files.set(relative, bytes.subarray(0, offset))
  } finally { await handle.close() }
  return total
}

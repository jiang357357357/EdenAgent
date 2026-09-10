import { openSync, closeSync, fstatSync, readSync, realpathSync, lstatSync, constants } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ConnectorCatalog } from './catalog.ts'
export function workerArtifact(catalog: ConnectorCatalog, key: string) {
  const { manifest, revision, packageRoot, native } = catalog.descriptor(key)
  if (native) return { executable: '', sha256: native.sha256, args: native.args, platform: native.platform, revision: native.revision }
  const platform = `${process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`
  const entry = manifest.entrypoints[platform]
  if (!entry) throw new Error('Official connector has no worker for this platform')
  if (path.isAbsolute(entry.path) || entry.path.includes('\\') || entry.path.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Invalid official worker path')
  const root = realpathSync(packageRoot)
  const candidate = path.join(root, entry.path)
  let current = root
  for (const part of entry.path.split('/')) { current = path.join(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error('Worker path contains a symbolic link') }
  const executable = realpathSync(candidate)
  if (!executable.startsWith(root + path.sep)) throw new Error('Worker escaped its official package')
  const fd = openSync(executable, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const hash = hashWorkerFile(fd)
    const sha256 = hash.digest('hex')
    return {
      executable, sha256, args: [...entry.args], platform,
      revision: createHash('sha256').update(JSON.stringify({ manifest: revision, platform, sha256, args: entry.args })).digest('hex')
    }
  } finally { closeSync(fd) }
}

function hashWorkerFile(fd: number) {
  const before = fstatSync(fd)
  if (!before.isFile() || before.size < 1 || before.size > 128 * 1024 * 1024) throw new Error('Invalid worker artifact size or type')
  const buffer = Buffer.alloc(65536), hash = createHash('sha256')
  let offset = 0
  while (offset < before.size) {
    const read = readSync(fd, buffer, 0, Math.min(buffer.length, before.size - offset), offset)
    if (!read) throw new Error('Worker artifact was truncated')
    hash.update(buffer.subarray(0, read)); offset += read
  }
  const after = fstatSync(fd)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Worker changed while computing its digest')
  return hash
}

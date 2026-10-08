import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, writeFile, mkdir, readdir, link, unlink, rename } from 'node:fs/promises'
import path from 'node:path'
import { MAX_FILE_BYTES } from './contracts.ts'
import { excluded, safeFile, safeRelative, verifyRoot } from './paths.ts'

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export interface Snapshot { path: string; sha256: string; size: number; bytes: Uint8Array }
export async function readSnapshot(root: string, relative: string): Promise<Snapshot | null> {
  let filename: string
  try { filename = await safeFile(root, relative) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  try {
    const before = await lstat(filename)
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_FILE_BYTES) throw new Error(`文件不可同步或超过 16 MiB：${relative}`)
    const bytes = await readFile(filename), after = await lstat(filename)
    if (bytes.length > MAX_FILE_BYTES || !after.isFile() || after.isSymbolicLink() || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`文件仍在修改中，稍后重试：${relative}`)
    return { path: relative, sha256: sha256(bytes), size: bytes.length, bytes }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
export async function scan(root: string, capture: (snapshot: Snapshot) => Promise<void>): Promise<Omit<Snapshot, 'bytes'>[]> {
  await verifyRoot(root)
  const result: Omit<Snapshot, 'bytes'>[] = [], names = new Set<string>()
  const walk = async (directory: string, prefix: string) => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + item.name
      if (excluded(relative)) continue
      safeRelative(relative)
      if (item.isSymbolicLink()) throw new Error(`资料库包含链接，请移除或排除：${relative}`)
      const key = relative.toLowerCase()
      if (names.has(key)) throw new Error(`文件名大小写冲突：${relative}`)
      names.add(key)
      if (item.isDirectory()) await walk(path.join(directory, item.name), relative + '/')
      else if (item.isFile()) {
        const value = await readSnapshot(root, relative)
        if (value) { await capture(value); result.push({ path: value.path, sha256: value.sha256, size: value.size }) }
      }
      else throw new Error(`资料库包含非普通文件：${relative}`)
    }
  }
  await walk(root, '')
  return result
}
export class SnapshotStore {
  readonly root: string
  constructor(dataRoot: string) { this.root = path.join(dataRoot, 'content') }
  async save(bytes: Uint8Array): Promise<string> {
    if (bytes.length > MAX_FILE_BYTES) throw new Error('文件超过 16 MiB')
    const hash = sha256(bytes)
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const destination = path.join(this.root, hash), temporary = destination + '.' + randomUUID()
    try { if ((await lstat(destination)).isFile()) return hash }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
    try { await link(temporary, destination) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    finally { await unlink(temporary) }
    if (sha256(await readFile(destination)) !== hash) throw new Error('本地内容快照校验失败')
    return hash
  }
  async read(hash: string): Promise<Uint8Array> {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('无效内容哈希')
    const bytes = await readFile(path.join(this.root, hash))
    if (bytes.length > MAX_FILE_BYTES || sha256(bytes) !== hash) throw new Error('本地内容快照损坏')
    return bytes
  }
}

/** Keep the displaced file on the same filesystem; never overwrite a racing editor's new file. */
export async function applySnapshot(root: string, relative: string, expected: string | null, bytes: Uint8Array | null, assertScope: () => void = () => {}): Promise<void> {
  assertScope()
  const existing = await readSnapshot(root, relative)
  if ((existing?.sha256 ?? null) !== expected) throw new Error('应用远端更新前本地文件已改变')
  const filename = await safeFile(root, relative, true), parent = path.dirname(filename)
  const temporary = path.join(parent, '.eden-share-' + randomUUID())
  let backup: string | null = null
  if (bytes) await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' })
  try {
    if (existing) {
      const backupRoot = path.join(root, '.eden-shared-backups')
      await mkdir(backupRoot, { recursive: false, mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
      if ((await lstat(backupRoot)).isSymbolicLink()) throw new Error('备份目录不能为链接')
      backup = path.join(backupRoot, randomUUID())
      assertScope()
      await rename(filename, backup)
      const savedHash = sha256(await readFile(backup))
      await writeFile(backup + '.json', JSON.stringify({ path: relative, sha256: savedHash, createdAt: Date.now() }) + '\n', { mode: 0o600, flag: 'wx' })
      if (savedHash !== expected) throw new Error('文件在应用更新时发生并发修改，已保留备份')
    }
    assertScope()
    if (bytes) await link(temporary, filename)
  } catch (error) {
    if (backup) {
      try { await link(backup, filename) }
      catch (restore) { if ((restore as NodeJS.ErrnoException).code !== 'EEXIST') throw new AggregateError([error, restore], '更新失败，本地内容保留在 .eden-shared-backups') }
    }
    throw error
  } finally {
    if (bytes) await unlink(temporary)
  }
}

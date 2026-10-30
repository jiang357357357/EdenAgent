import { access, lstat, readdir, realpath } from 'node:fs/promises'
import { constants, lstatSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { LanError } from './contracts.ts'
import type { DirectoryListing, SourceBinding } from './source-contracts.ts'

export function assertBoundDirectory(binding: Pick<SourceBinding, 'path' | 'identity'>): void {
  const info = lstatSync(binding.path, { bigint: true })
  if (!info.isDirectory() || info.isSymbolicLink() || `${info.dev}:${info.ino}` !== binding.identity || realpathSync(binding.path) !== binding.path)
    throw new Error('云端源目录身份或真实路径已变化，请管理员核对')
}

export function containsDirectory(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function absoluteDirectory(requested: string) {
  if (!requested || requested.length > 4096 || !path.isAbsolute(requested) || requested.includes('\0')
    || requested.split(/[\\/]/).includes('..')) throw new LanError(400, '请输入云主机上的目录绝对路径')
  return path.resolve(requested)
}

export function assertPublishable(root: string, privateRoot: string) {
  if (containsDirectory(root, privateRoot)) throw new LanError(403, '不能共享云主机运行数据、密钥或其上级目录')
  const systemRoot = process.platform !== 'win32' && ['/proc', '/sys', '/dev', '/run', '/etc', '/usr', '/boot', '/bin', '/lib', '/sbin']
    .some(system => containsDirectory(system, root))
  if (root === path.parse(root).root || systemRoot) throw new LanError(403, '不能将系统目录作为共享源')
}

export async function directoryIdentity(requested: string, privateRoot: string, binding = false) {
  const root = absoluteDirectory(requested)
  let current = path.parse(root).root
  for (const part of root.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    if ((await lstat(current)).isSymbolicLink()) throw new LanError(400, '云端目录不能经过符号链接')
  }
  const info = await lstat(root, { bigint: true })
  const canonical = await realpath(root)
  const samePath = process.platform === 'win32' ? canonical.toLowerCase() === root.toLowerCase() : canonical === root
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath) throw new LanError(400, '云端目录不是可直接访问的文件夹')
  if (containsDirectory(privateRoot, root))
    throw new LanError(403, '不能共享云主机运行数据、密钥或其上级目录')
  if (binding) assertPublishable(root, privateRoot)
  await access(root, binding ? constants.R_OK | constants.W_OK | constants.X_OK : constants.R_OK | constants.X_OK)
  return { path: canonical, identity: `${info.dev}:${info.ino}` }
}

export async function listSourceDirectories(privateRoot: string, requested?: string, after?: string): Promise<DirectoryListing> {
  const selected = await directoryIdentity(requested || homedir(), privateRoot)
  const children = await readdir(selected.path, { withFileTypes: true })
  const names = children.filter(entry => entry.isDirectory() && !entry.isSymbolicLink()
    && !containsDirectory(privateRoot, path.join(selected.path, entry.name))).map(entry => entry.name).sort()
  const start = after ? names.findIndex(name => name > after) : 0
  const page = start < 0 ? [] : names.slice(start, start + 200)
  const parent = path.dirname(selected.path)
  let reason: string | null = null
  try { await directoryIdentity(selected.path, privateRoot, true) } catch (error) { reason = error instanceof Error ? error.message : '此目录不能作为共享源' }
  return { path: selected.path, parent: parent === selected.path ? null : parent,
    entries: page.map(name => ({ name, path: path.join(selected.path, name) })), truncated: start >= 0 && start + page.length < names.length,
    selectable: !reason, reason }
}

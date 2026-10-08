import path from 'node:path'
import { lstat, realpath, mkdir } from 'node:fs/promises'

const excludedDirectories = new Set(['.git', '.venv', 'node_modules', '__pycache__', '.run', '.release', '.data', '.eden-shared-backups'])
const credentials = new Set(['capability.token', 'server-capability.token', 'pairing-token', 'id_rsa', 'id_ed25519'])
export function safeRelative(value: string): string {
  if (!value || Buffer.byteLength(value) > 1024 || value !== value.normalize('NFC') || value.includes('\\') || /[\x00-\x1f\x7f<>:"|?*]/.test(value)) throw new Error('无效共享文件路径')
  const parts = value.split('/')
  if (parts.some(p => !p || Buffer.byteLength(p) > 255 || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('不兼容的共享文件路径')
  if (excluded(value)) throw new Error('运行数据或凭据路径不能加入共享资料库')
  return value
}
export function excluded(value: string): boolean {
  const parts = value.toLowerCase().split('/')
  return parts.some(p => excludedDirectories.has(p) || credentials.has(p) || p.startsWith('.eden-share-') || p === '.env' || p.startsWith('.env.')
    || /\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/.test(p) || /\.(pem|key|pfx|p12)$/.test(p))
    || parts.some((p, i) => p === 'config' && parts[i + 1] === 'env')
}
export async function verifyRoot(root: string): Promise<string> {
  if (!path.isAbsolute(root)) throw new Error('共享目录必须是绝对路径')
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('共享目录不可用或为链接')
  return realpath(root)
}
export async function safeFile(root: string, relative: string, createParents = false): Promise<string> {
  safeRelative(relative)
  const canonical = await verifyRoot(root)
  const parts = relative.split('/')
  let current = canonical
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part)
    if (createParents) await mkdir(current, { recursive: false }).catch(error => { if (error.code !== 'EEXIST') throw error })
    const stat = await lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('共享目录包含符号链接或无效父目录')
  }
  const filename = path.join(current, parts.at(-1)!)
  try { if ((await lstat(filename)).isSymbolicLink()) throw new Error('共享文件不能是符号链接') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  return filename
}

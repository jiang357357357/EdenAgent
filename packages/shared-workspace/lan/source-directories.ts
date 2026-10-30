import { access, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { safeRelative } from '../client/paths.ts'
import { LanError } from './contracts.ts'
import { assertBoundDirectory, assertPublishable, containsDirectory, directoryIdentity } from './source-paths.ts'

function directoryName(value: string) {
  const name = value.trim().normalize('NFC')
  try {
    if (name.includes('/') || name.includes('\\')) throw new Error('路径不能作为名称')
    return safeRelative(name)
  } catch { throw new LanError(400, '文件夹名称无效，请使用单个名称，避免路径、保留名称或过长名称') }
}

/** Creates exactly one new child; existing files and directories are never reused or overwritten. */
export async function createSourceDirectory(privateRoot: string, parentPath: string, name: string, checkTarget: (target: string) => void) {
  const childName = directoryName(name)
  const parent = await directoryIdentity(parentPath, privateRoot)
  const target = path.join(parent.path, childName)
  if (containsDirectory(privateRoot, target)) throw new LanError(403, '不能在云主机运行数据目录中创建共享文件夹')
  assertPublishable(target, privateRoot)
  checkTarget(target)
  try {
    await access(parent.path, constants.R_OK | constants.W_OK | constants.X_OK)
    assertBoundDirectory(parent)
    await mkdir(target, { mode: 0o755 })
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') throw new LanError(409, '已存在同名文件夹或文件，请换个名称')
    if (['EACCES', 'EPERM', 'EROFS'].includes(code ?? '')) throw new LanError(403, '云主机服务没有权限在此位置创建文件夹')
    throw error
  }
  assertBoundDirectory(parent)
  const created = await directoryIdentity(target, privateRoot, true)
  return { path: created.path }
}

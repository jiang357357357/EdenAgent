import { realpath, lstat } from 'node:fs/promises'
import path from 'node:path'
import type { ConnectorPermissions } from './permissions.ts'
import type { ConnectorCatalog } from './catalog.ts'

/** Resolve approved setting paths to fixed guest mounts; no package-supplied host paths are mounted implicitly. */
export async function nativeMounts(dataRoot: string, settings: Record<string, unknown>, descriptor: ReturnType<ConnectorCatalog['descriptor']>, grants: ReturnType<ConnectorPermissions['require']>) {
  const workerSettings = { ...settings }, readMounts: { source: string; target: string }[] = [], writeMounts: { source: string; target: string }[] = []
  const workerGrants: { capability: string; resource: string; access: string }[] = []
  const privateRoot = await realpath(dataRoot)
  for (const permission of descriptor.manifest.permissions) {
    const key = permission.resource.startsWith('settings.') ? permission.resource.slice(9) : null
    const resource = key ? settings[key] : permission.resource
    const granted = grants.some(item => item.capability === permission.capability && item.resource === resource && item.access === permission.access)
    if (!granted) { if (key) delete workerSettings[key]; continue }
    if (!key || typeof resource !== 'string' || !['filesystem.read', 'filesystem.write'].includes(permission.capability)) throw new Error('Native plugin requires a dedicated adapter for non-filesystem permissions')
    const source = await realpath(resource), info = await lstat(source), write = permission.capability === 'filesystem.write'
    if (!path.isAbsolute(resource) || (await lstat(resource)).isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (write && !info.isDirectory())) throw new Error('Native plugin mount has an invalid path or type')
    const protectedRoots = [privateRoot, path.resolve(dataRoot, '..', '..'), path.resolve('Data'), '/proc', '/dev', '/sys', '/etc']
    if (write) protectedRoots.push('/usr', '/bin', '/sbin', '/lib', '/lib64')
    if (source === path.parse(source).root || protectedRoots.some(root => source === root || source.startsWith(root + path.sep) || root.startsWith(source + path.sep))) throw new Error('Native plugin mount overlaps private or protected host data')
    if ((write && permission.access !== 'write') || (!write && permission.access !== 'read')) throw new Error('Native plugin mount access does not match its capability')
    if (workerGrants.length >= 16) throw new Error('Native plugin exceeds mount count limit')
    const target = `${write ? '/outputs' : '/inputs'}/resource_${workerGrants.length}`
    const mounts = write ? writeMounts : readMounts
    mounts.push({ source, target })
    workerSettings[key] = target
    workerGrants.push({ capability: permission.capability, resource: target, access: permission.access })
  }
  return { workerSettings, readMounts, writeMounts, workerGrants }
}

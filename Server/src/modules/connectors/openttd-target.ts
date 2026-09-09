import { openSync, closeSync, fstatSync, readSync, constants, realpathSync } from 'node:fs'
import { z } from 'zod'
import path from 'node:path'
import { assertOpenTtdProcess } from './openttd-process.ts'

const absolute = z.string().min(1).max(4096).refine(path.isAbsolute, 'Expected absolute path')
const port = z.number().int().min(1).max(65535)
const managed = z.object({ instance_id: z.string().regex(/^[a-fA-F0-9]{32}$/), host: z.enum(['127.0.0.1', 'localhost']),
  admin_port: port, game_port: port, pid: z.number().int().positive().max(2147483647), mode: z.enum(['host', 'dedicated']),
  started_at: z.string().min(1).max(128), process_start_ticks: z.string().regex(/^\d{1,32}$/),
  process_executable: absolute, launch_target: absolute, config_path: absolute })
type Grant = { capability: string; resource: string; access: string }
export function openTtdTarget(settings: Record<string, unknown>, grants: Grant[], dataRoot: string) {
  if (settings.host !== undefined || settings.adminPort !== undefined) {
    z.enum(['127.0.0.1', 'localhost']).parse(settings.host)
    const adminPort = port.parse(settings.adminPort), gamePort = port.parse(settings.gamePort ?? 3979)
    if (adminPort === gamePort) throw new Error('OpenTTD game and Admin ports must differ')
    return { adminPort, gamePort, registry: null, assertCurrent() {} }
  }
  const registry = absolute.parse(settings.instanceRegistry)
  if (!grants.some(item => item.capability === 'filesystem.read' && item.access === 'read' && item.resource === registry)) {
    throw new Error('Approve the OpenTTD instance registry file before discovering the game')
  }
  const canonical = realpathSync(registry)
  for (const root of [path.resolve('Data'), realpathSync(dataRoot)]) {
    if (canonical === root || canonical.startsWith(root + path.sep)) throw new Error('OpenTTD registry cannot read private Agent data')
  }
  const bytes = readRegistry(registry), instance = managed.parse(JSON.parse(bytes.toString('utf8')))
  if (instance.admin_port === instance.game_port) throw new Error('OpenTTD game and Admin ports must differ')
  const assertCurrent = () => {
    if (realpathSync(registry) !== canonical || !bytes.equals(readRegistry(registry))) throw new Error('OpenTTD registry changed; reconnect to discover its new instance')
    assertOpenTtdProcess(instance)
  }
  assertCurrent()
  return { adminPort: instance.admin_port, gamePort: instance.game_port, registry, assertCurrent }
}

function readRegistry(file: string) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = fstatSync(fd)
    if (!before.isFile() || before.size < 1 || before.size > 65536) throw new Error('Invalid OpenTTD registry file size or type')
    const bytes = Buffer.alloc(before.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset)
      if (!count) throw new Error('OpenTTD registry truncated while reading')
      offset += count
    }
    const after = fstatSync(fd)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('OpenTTD registry changed while reading')
    return bytes
  } finally { closeSync(fd) }
}

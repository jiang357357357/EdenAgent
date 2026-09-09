import { mkdir, realpath, lstat } from 'node:fs/promises'
import path from 'node:path'
import { launchConnectorProcess } from '@eden/execution'
import type { ConnectorCatalog } from './catalog.ts'
import type { ConnectorRepository } from './repository.ts'
import type { ConnectorPermissions } from './permissions.ts'
import type { ConnectorEventRepository } from './event-repository.ts'
import { workerArtifact } from './worker-artifact.ts'
import { ConnectorWorkerRuntime } from './worker-runtime.ts'
export async function launchObserver(id: string, dataRoot: string, repository: ConnectorRepository, catalog: ConnectorCatalog,
  permissions: ConnectorPermissions, events: ConnectorEventRepository, signal: AbortSignal) {
  const current = repository.read(id), descriptor = catalog.descriptor(current.connectorKey)
  if (!['hoi4', 'victoria3'].includes(current.connectorKey)) throw new Error('Network connector transport is awaiting implementation')
  const snapshot = permissions.read(id), granted = permissions.require(id, current.generation)
  const artifact = workerArtifact(catalog, current.connectorKey)
  if (artifact.revision !== snapshot.revision) throw new Error('Worker artifact changed after approval')
  const log = granted.find(item => item.capability === 'filesystem.read' && item.access === 'read')
  if (!log || typeof current.settings.logPath !== 'string' || log.resource !== current.settings.logPath) throw new Error('Observer requires an explicitly approved log path')
  const source = await realpath(log.resource)
  if (!(await lstat(source)).isFile()) throw new Error('Observer input must be a regular log file')
  for (const root of [path.resolve('Data'), await realpath(dataRoot)]) {
    if (source === root || source.startsWith(root + path.sep)) throw new Error('Connector cannot mount private Agent data')
  }
  const writeMounts: { source: string; target: string }[] = []
  const workerSettings = { ...current.settings, logPath: '/inputs/log', controlEnabled: false }
  const workerGrants = [{ capability: 'filesystem.read', resource: '/inputs/log', access: 'read' }]
  if (current.connectorKey === 'victoria3' && current.settings.controlEnabled === true) {
    const write = granted.find(item => item.capability === 'filesystem.write' && item.access === 'write' && item.resource === current.settings.commandDirectory)
    if (!write) throw new Error('Victoria 3 control requires an approved command directory')
    const commands = await realpath(write.resource)
    if (!(await lstat(commands)).isDirectory()) throw new Error('Control command directory must already exist')
    const protectedRoots = [path.resolve('Data'), await realpath(dataRoot), path.parse(commands).root, '/usr', '/etc', '/proc', '/dev', '/sys']
    if (protectedRoots.some(root => commands === root || (root !== path.parse(commands).root && (commands.startsWith(root + path.sep) || root.startsWith(commands + path.sep))))) {
      throw new Error('Control directory overlaps a protected host path')
    }
    writeMounts.push({ source: commands, target: '/outputs/commands' })
    workerSettings.controlEnabled = true
    workerSettings.commandDirectory = '/outputs/commands'
    workerGrants.push({ capability: 'filesystem.write', resource: '/outputs/commands', access: 'write' })
  }
  const directory = path.join(dataRoot, 'connectors', id)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  signal.throwIfAborted()
  if (repository.read(id).generation !== current.generation) throw new Error('Connector settings changed before launch')
  const process = await launchConnectorProcess({ executable: artifact.executable, sha256: artifact.sha256, args: artifact.args,
    dataDirectory: directory, readMounts: [{ source, target: '/inputs/log' }], writeMounts, signal })
  const runtime = new ConnectorWorkerRuntime(id, current.generation, process.input, process.output, repository, events, () => process.stop())
  try {
    await runtime.initialize({ protocolVersion: 1, connectorInstanceId: id, connectorKey: current.connectorKey, packageVersion: descriptor.manifest.version,
      settings: workerSettings, grantedPermissions: workerGrants, dataDirectory: '/data' }, current.settings)
  } catch (error) { await runtime.close(); throw error }
  return { runtime, generation: current.generation, revision: snapshot.revision, exited: process.exited }
}

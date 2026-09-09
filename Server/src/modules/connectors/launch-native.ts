import { prepareWorker } from './prepare-worker.ts'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { launchConnectorProcess } from '@eden/execution'
import type { ConnectorCatalog } from './catalog.ts'
import type { ConnectorRepository } from './repository.ts'
import type { ConnectorPermissions } from './permissions.ts'
import type { ConnectorEventRepository } from './event-repository.ts'
import { ConnectorWorkerRuntime } from './worker-runtime.ts'
import { nativeMounts } from './native-mounts.ts'

export async function launchNative(id: string, dataRoot: string, repository: ConnectorRepository, catalog: ConnectorCatalog,
  permissions: ConnectorPermissions, events: ConnectorEventRepository, signal: AbortSignal) {
  const current = repository.read(id), descriptor = catalog.descriptor(current.connectorKey), plan = descriptor.native
  if (!plan) throw new Error('Connector is not owned by a native plugin component')
  const granted = permissions.require(id, current.generation)
  const authorize = () => {
    signal.throwIfAborted()
    const latest = repository.read(id), active = catalog.descriptor(current.connectorKey), now = permissions.read(id)
    if (latest.generation !== current.generation || latest.desiredState !== 'connected' || active.native?.revision !== plan.revision || !now.ready || now.revision !== plan.revision) throw new Error('Native plugin version, component or connector authorization changed')
    const grants = permissions.require(id, current.generation)
    if (granted.some(original => !grants.some(item => item.capability === original.capability && item.resource === original.resource && item.access === original.access))) throw new Error('Native plugin mount authorization changed')
  }
  authorize()
  const mounts = await nativeMounts(dataRoot, current.settings, descriptor, granted)
  const directory = path.join(dataRoot, 'connectors', id)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  let prepared: Awaited<ReturnType<typeof prepareWorker>> | undefined
  let child: Awaited<ReturnType<typeof launchConnectorProcess>> | undefined
  try {
    prepared = await prepareWorker(catalog, current.connectorKey, dataRoot, plan.revision)
    authorize()
    child = await launchConnectorProcess({ executable: prepared.executable, packageSnapshot: prepared.packageSnapshot, sha256: plan.sha256, args: plan.args, dataDirectory: directory,
      readMounts: mounts.readMounts, writeMounts: mounts.writeMounts, signal })
    const process = child, exited = process.exited.finally(() => prepared?.cleanup())
    void exited.catch(() => { globalThis.process.stderr.write('Native worker cache cleanup failed\n') })
    const runtime = new ConnectorWorkerRuntime(id, current.generation, process.input, process.output, repository, events,
      async () => { await process.stop(); await exited }, authorize, plan.manifest.id)
    try {
      await runtime.initialize({ protocolVersion: 1, connectorInstanceId: id, connectorKey: plan.manifest.id,
        packageVersion: plan.manifest.version, settings: mounts.workerSettings, grantedPermissions: mounts.workerGrants, dataDirectory: '/data' }, current.settings)
      authorize()
    } catch (error) { await runtime.close(); throw error }
    return { runtime, generation: current.generation, revision: plan.revision, exited }
  } catch (error) {
    try { await child?.stop() } finally { await prepared?.cleanup() }
    throw error
  }
}

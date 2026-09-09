import { prepareWorker } from './prepare-worker.ts'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { launchConnectorProcess } from '@eden/execution'
import type { ConnectorCatalog } from './catalog.ts'
import type { ConnectorRepository } from './repository.ts'
import type { ConnectorPermissions } from './permissions.ts'
import type { ConnectorCredentials } from './credentials.ts'
import type { ConnectorEventRepository } from './event-repository.ts'
import { workerArtifact } from './worker-artifact.ts'
import { ConnectorWorkerRuntime } from './worker-runtime.ts'
import { createTcpBridge } from './tcp-bridge.ts'
import { lichessEndpoint, resolveLichessEndpoint } from './lichess-target.ts'

export async function launchLichess(id: string, dataRoot: string, repository: ConnectorRepository, catalog: ConnectorCatalog,
  permissions: ConnectorPermissions, events: ConnectorEventRepository, credentials: ConnectorCredentials, signal: AbortSignal) {
  const current = repository.read(id)
  if (catalog.descriptor(current.connectorKey).manifest.id !== 'lichess') throw new Error('Invalid Lichess connector')
  const endpoint = lichessEndpoint(current.settings.baseUrl), artifact = workerArtifact(catalog, current.connectorKey)
  const authorize = () => {
    const latest = repository.read(id), grants = permissions.read(id)
    if (latest.generation !== current.generation || latest.desiredState !== 'connected' || !grants.ready || grants.revision !== artifact.revision
      || !grants.permissions.some(item => item.allowed && item.capability === 'network.connect' && item.access === 'connect' && item.resolvedResource === endpoint.resource)) {
      throw new Error('Lichess endpoint permission is missing or stale')
    }
  }
  authorize()
  const credential = credentials.forWorker(id, current.generation, permissions)
  const target = await resolveLichessEndpoint(endpoint.url, signal)
  authorize()
  const directory = path.join(dataRoot, 'connectors', id)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const bridge = await createTcpBridge(target, authorize, signal)
  let prepared: Awaited<ReturnType<typeof prepareWorker>> | undefined
  let process: Awaited<ReturnType<typeof launchConnectorProcess>> | undefined
  try {
    authorize(); signal.throwIfAborted()
    prepared = await prepareWorker(catalog, current.connectorKey, dataRoot, artifact.revision)
    authorize(); signal.throwIfAborted()
    process = await launchConnectorProcess({ executable: prepared.executable, packageSnapshot: prepared.packageSnapshot, sha256: artifact.sha256, args: artifact.args,
      dataDirectory: directory, readMounts: [], httpsBridgeDirectory: bridge.directory,
      identity: { key: current.identityKey, credential }, signal })
    const child = process, exited = child.exited.finally(async () => { try { await bridge.close() } finally { await prepared?.cleanup() } })
    void exited.catch(() => { globalThis.process.stderr.write('Lichess bridge exit cleanup failed\n') })
    const runtime = new ConnectorWorkerRuntime(id, current.generation, child.input, child.output, repository, events,
      async () => { await child.stop(); await exited }, authorize, 'lichess')
    try {
      await runtime.initialize({ protocolVersion: 1, connectorInstanceId: id, connectorKey: 'lichess',
        packageVersion: catalog.descriptor(current.connectorKey).manifest.version,
        settings: { ...current.settings, baseUrl: endpoint.url.href.replace(/\/$/, ''), tokenEnv: 'MON_CONNECTOR_IDENTITY_CREDENTIAL' },
        grantedPermissions: permissions.require(id, current.generation), dataDirectory: '/data' }, current.settings)
      authorize()
    } catch (error) { await runtime.close(); throw error }
    return { runtime, generation: current.generation, revision: artifact.revision, exited }
  } catch (error) {
    try { await process?.stop() } finally { try { await bridge.close() } finally { await prepared?.cleanup() } }
    throw error
  }
}

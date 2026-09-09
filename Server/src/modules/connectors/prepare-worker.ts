import type { ConnectorCatalog } from './catalog.ts'
import { workerArtifact } from './worker-artifact.ts'

/** Pass immutable package bytes to the isolation owner; never mount a mutable plugin installation directory. */
export async function prepareWorker(catalog: ConnectorCatalog, key: string, _dataRoot: string, expectedRevision: string) {
  const descriptor = catalog.descriptor(key), artifact = workerArtifact(catalog, key)
  if (artifact.revision !== expectedRevision) throw new Error('Worker changed before executable preparation')
  if (!descriptor.native) return { executable: artifact.executable, packageSnapshot: undefined, async cleanup() {} }
  if (descriptor.native.revision !== expectedRevision || descriptor.native.sha256 !== artifact.sha256) throw new Error('Native worker plan changed during preparation')
  return { executable: '', packageSnapshot: { files: descriptor.native.files, entrypoint: descriptor.native.executablePath }, async cleanup() {} }
}

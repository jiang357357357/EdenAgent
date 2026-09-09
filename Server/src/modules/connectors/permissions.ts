import { workerArtifact } from './worker-artifact.ts'
import { createHash, randomUUID } from 'node:crypto'
import { connectorPermissionSetSchema, rpcMethods } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { ConnectorCatalog } from './catalog.ts'
import type { ConnectorRepository } from './repository.ts'
export class ConnectorPermissions {
  constructor(private readonly database: EdenDatabase, private readonly catalog: ConnectorCatalog, private readonly connectors: ConnectorRepository) {}
  read(id: string) {
    const connector = this.connectors.read(id)
    let descriptor: ReturnType<ConnectorCatalog['descriptor']>
    try { descriptor = this.catalog.descriptor(connector.connectorKey) }
    catch {
      return { id, generation: connector.generation, revision: createHash('sha256').update(`unavailable:${connector.connectorKey}`).digest('hex'),
        permissions: [], ready: false, worker: { available: false, sha256: null, error: 'Connector component is unavailable; disconnect or clear its previous grants before restoring it' } }
    }
    let artifact: ReturnType<typeof workerArtifact> | undefined
    try { artifact = workerArtifact(this.catalog, connector.connectorKey) } catch { /* Missing artifacts block new grants and activation below. */ }
    const revision = artifact?.revision ?? descriptor.revision
    const hasCredential = Boolean(this.database.connection.prepare('SELECT 1 FROM connector_credentials WHERE connector_id=?').get(id))
    const permissions = descriptor.manifest.permissions.map(permission => {
      const setting = permission.resource.startsWith('settings.') ? connector.settings[permission.resource.slice('settings.'.length)] : undefined
      const resource = permission.resource === 'connector.identityCredential' && !hasCredential ? null
        : permission.resource.startsWith('settings.') ? typeof setting === 'string' && setting.trim() ? setting : null : permission.resource
      const key = createHash('sha256').update(JSON.stringify({ ...permission, resolvedResource: resource })).digest('hex')
      const row = this.database.connection.prepare('SELECT allowed FROM connector_grants WHERE connector_id=? AND generation=? AND revision=? AND permission_key=?')
        .get(id, connector.generation, revision, key)
      return { ...permission, key, resolvedResource: resource, allowed: row?.allowed === 1 }
    })
    return { id, generation: connector.generation, revision, permissions, worker: { available: Boolean(artifact), sha256: artifact?.sha256 ?? null,
        error: artifact ? null : 'Current platform worker artifact is missing or invalid' },
      ready: Boolean(artifact) && permissions.every(permission => !permission.required || (permission.resolvedResource !== null && permission.allowed)) }
  }
  clear(raw: unknown) {
    const input = rpcMethods['connector.permissions.clear'].params.parse(raw)
    this.database.transaction(() => {
      const current = this.connectors.read(input.id)
      if (current.generation !== input.generation) throw new Error('Connector changed; refresh before clearing permissions')
      this.database.connection.prepare('DELETE FROM connector_grants WHERE connector_id=?').run(input.id)
      this.database.connection.prepare("UPDATE connectors SET generation=?,desired_state='disconnected',runtime_state='disconnected',last_error=NULL,updated_at=? WHERE id=?")
        .run(randomUUID(), Date.now(), input.id)
    })
    return this.read(input.id)
  }
  set(raw: unknown) {
    const input = connectorPermissionSetSchema.parse(raw)
    if (new Set(input.decisions.map(item => item.key)).size !== input.decisions.length) throw new Error('Duplicate connector permission decision')
    this.database.transaction(() => {
      const current = this.read(input.id)
      if (current.generation !== input.generation || current.revision !== input.revision) throw new Error('Connector changed; review its permissions again')
      if (!current.worker.available && input.decisions.some(item => item.allowed)) throw new Error('Install a valid platform worker before granting execution resources')
      for (const decision of input.decisions) {
        const permission = current.permissions.find(item => item.key === decision.key)
        if (!permission || (decision.allowed && permission.resolvedResource === null)) throw new Error('Permission is undeclared or its resource is unconfigured')
        this.database.connection.prepare('INSERT INTO connector_grants VALUES(?,?,?,?,?,?) ON CONFLICT(connector_id,generation,revision,permission_key) DO UPDATE SET allowed=excluded.allowed,updated_at=excluded.updated_at')
          .run(input.id, input.generation, input.revision, decision.key, Number(decision.allowed), Date.now())
      }
      if (input.decisions.some(item => !item.allowed)) this.database.connection.prepare("UPDATE connectors SET desired_state='disconnected',runtime_state='disconnected',last_error=NULL,updated_at=? WHERE id=?")
        .run(Date.now(), input.id)
    })
    return this.read(input.id)
  }
  require(id: string, generation: string) {
    const snapshot = this.read(id)
    if (snapshot.generation !== generation || !snapshot.ready) throw new Error('Connector permissions are missing or stale')
    return snapshot.permissions.filter(item => item.allowed && item.resolvedResource !== null).map(item => ({ capability: item.capability, resource: item.resolvedResource!, access: item.access }))
  }
}

import type { ConnectorCatalog } from './catalog.ts'
import { randomUUID } from 'node:crypto'
import { connectorCredentialReadSchema, connectorCredentialSetSchema, connectorCredentialRemoveSchema } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { ConnectorRepository } from './repository.ts'
import type { ConnectorPermissions } from './permissions.ts'

/** Private world database only. No secret read RPC, model tool, public event or environment fallback. */
export class ConnectorCredentials {
  constructor(private readonly database: EdenDatabase, private readonly connectors: ConnectorRepository, private readonly catalog?: ConnectorCatalog) {}
  read(raw: unknown) {
    const { id } = connectorCredentialReadSchema.parse(raw), connector = this.connectors.read(id)
    const row = this.database.connection.prepare('SELECT updated_at FROM connector_credentials WHERE connector_id=?').get(id)
    return { id, generation: connector.generation, supported: this.supports(connector.connectorKey),
      configured: Boolean(row), updatedAt: row ? Number(row.updated_at) : null }
  }
  set(raw: unknown) {
    const input = connectorCredentialSetSchema.parse(raw)
    this.database.transaction(() => {
      this.rotate(input.id, input.generation)
      this.database.connection.prepare(`INSERT INTO connector_credentials(connector_id,secret,updated_at) VALUES(?,?,?)
        ON CONFLICT(connector_id) DO UPDATE SET secret=excluded.secret,updated_at=excluded.updated_at`)
        .run(input.id, input.secret, Date.now())
    })
    return this.read({ id: input.id })
  }
  remove(raw: unknown) {
    const input = connectorCredentialRemoveSchema.parse(raw)
    this.database.transaction(() => {
      this.rotate(input.id, input.generation)
      this.database.connection.prepare('DELETE FROM connector_credentials WHERE connector_id=?').run(input.id)
    })
    return this.read({ id: input.id })
  }
  forWorker(id: string, generation: string, permissions: ConnectorPermissions): string {
    const current = this.connectors.read(id)
    if (current.generation !== generation || current.desiredState !== 'connected') throw new Error('Connector credential generation is no longer active')
    const granted = permissions.require(id, generation)
    if (!granted.some(item => item.capability === 'environment.read' && item.access === 'read' && item.resource === 'connector.identityCredential')) {
      throw new Error('Connector identity credential access is not granted')
    }
    const row = this.database.connection.prepare('SELECT secret FROM connector_credentials WHERE connector_id=?').get(id)
    if (!row) throw new Error('Configure the private credential for this connector identity')
    return String(row.secret)
  }
  private supports(key: string): boolean {
    if (['lichess', 'openttd'].includes(key)) return true
    try {
      const descriptor = this.catalog?.descriptor(key)
      return Boolean(descriptor?.native && ['lichess', 'openttd'].includes(descriptor.manifest.id)
        && descriptor.manifest.permissions.some(item => item.capability === 'environment.read' && item.access === 'read' && item.resource === 'connector.identityCredential'))
    } catch { return false }
  }
  private rotate(id: string, generation: string) {
    const current = this.connectors.read(id)
    if (!this.supports(current.connectorKey) && !this.database.connection.prepare('SELECT 1 FROM connector_credentials WHERE connector_id=?').get(id)) throw new Error('This connector does not accept an identity credential')
    if (current.generation !== generation) throw new Error('Connector changed; reload before changing its credential')
    // Existing workers and grants must not survive credential replacement or removal.
    this.database.connection.prepare(`UPDATE connectors SET generation=?,desired_state='disconnected',runtime_state='disconnected',last_error=NULL,updated_at=? WHERE id=?`)
      .run(randomUUID(), Date.now(), id)
  }
}

import { randomUUID } from 'node:crypto'
import { connectorCreateSchema, connectorUpdateSchema, connectorHistorySchema, toJson } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { ConnectorCatalog } from './catalog.ts'
export class ConnectorRepository {
  constructor(private readonly database: EdenDatabase, private readonly catalog: ConnectorCatalog) {}
  read(id: string) {
    const row = this.database.connection.prepare('SELECT * FROM connectors WHERE id=?').get(id)
    if (!row) throw new Error('Connector identity not found in this world')
    return { id: String(row.id), generation: String(row.generation), connectorKey: String(row.connector_key), identityKey: String(row.identity_key), displayName: String(row.display_name),
      desiredState: String(row.desired_state), runtimeState: String(row.runtime_state), settings: JSON.parse(String(row.settings_json)),
      lastError: row.last_error === null ? null : String(row.last_error), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }
  }
  list() { return this.database.connection.prepare('SELECT id FROM connectors ORDER BY created_at,id').all().map(row => this.read(String(row.id))) }
  create(raw: unknown) {
    const input = connectorCreateSchema.parse(raw), settings = this.catalog.validate(input.connectorKey, input.settings)
    this.validateBinding(settings)
    const id = randomUUID(), now = Date.now()
    this.database.connection.prepare('INSERT INTO connectors VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, input.connectorKey, input.identityKey,
      input.displayName, input.desiredState, input.desiredState === 'connected' ? 'error' : 'disconnected', JSON.stringify(settings),
      input.desiredState === 'connected' ? 'Waiting for worker resources and permission approval' : null, now, now, randomUUID())
    return this.read(id)
  }
  update(raw: unknown) {
    const { id, patch } = connectorUpdateSchema.parse(raw), current = this.read(id)
    const settings = patch.settings === undefined ? current.settings : this.catalog.validate(current.connectorKey, patch.settings)
    if (patch.settings !== undefined || patch.desiredState === 'connected') {
      this.catalog.validate(current.connectorKey, settings)
      this.validateBinding(settings)
    }
    const desired = patch.desiredState ?? current.desiredState
    const changed = JSON.stringify(settings) !== JSON.stringify(current.settings)
    const reset = changed || desired !== current.desiredState
    this.database.connection.prepare('UPDATE connectors SET display_name=?,desired_state=?,runtime_state=?,settings_json=?,last_error=?,updated_at=?,generation=? WHERE id=?')
      .run(patch.displayName ?? current.displayName, desired, reset ? desired === 'connected' ? 'connecting' : 'disconnected' : current.runtimeState, JSON.stringify(settings),
        reset ? null : current.lastError, Date.now(), changed ? randomUUID() : current.generation, id)
    return this.read(id)
  }
  history(raw: unknown) {
    const input = connectorHistorySchema.parse(raw)
    this.read(input.id)
    const rows = this.database.connection.prepare(`SELECT rowid AS cursor,id,session_id,generation,method,state,error,created_at,updated_at
      FROM connector_operations WHERE connector_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?`)
      .all(input.id, input.before ?? Number.MAX_SAFE_INTEGER, input.limit + 1)
    return toJson({ items: rows.slice(0, input.limit).map(row => ({ id: String(row.id), sessionId: String(row.session_id), generation: String(row.generation),
      method: String(row.method), state: String(row.state), error: row.error === null ? null : String(row.error),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) })), nextCursor: rows.length > input.limit ? Number(rows[input.limit - 1]!.cursor) : null })
  }
  runtimeState(id: string, generation: string, state: 'connecting' | 'connected' | 'disconnected' | 'error', error: string | null) {
    const result = this.database.connection.prepare('UPDATE connectors SET runtime_state=?,last_error=?,updated_at=? WHERE id=? AND generation=?')
      .run(state, error, Date.now(), id, generation)
    if (Number(result.changes) !== 1) throw new Error('Connector runtime generation has changed')
  }
  private validateBinding(settings: import('@eden/api').JsonValue) {
    if (settings && typeof settings === 'object' && !Array.isArray(settings) && typeof settings.boundSessionId === 'string' &&
      !this.database.connection.prepare("SELECT 1 FROM sessions WHERE id=? AND status='active'").get(settings.boundSessionId)) throw new Error('Connector bound session must be active in this world')
  }
}

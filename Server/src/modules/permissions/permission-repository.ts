import { jsonValue } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import { permissionScope } from '@eden/permissions'
import type { PermissionEventSink, PermissionRequest } from './contracts.ts'

export class PermissionRepository {
  constructor(private readonly database: EdenDatabase, readonly events: PermissionEventSink) {}

  insert(request: PermissionRequest) {
    return this.database.transaction(() => {
      this.database.connection.prepare('INSERT INTO permission_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(request.id, request.sessionId, request.turnId, request.operationId, request.capability, request.resource, request.state, JSON.stringify(request.details), request.createdAt)
      return this.events.insert(request.sessionId, request.turnId, request.state === 'pending' ? 'permission.requested' : 'permission.applied', { ...request, request: request.details })
    })
  }

  list(sessionId?: string): PermissionRequest[] {
    const rows = sessionId ? this.database.connection.prepare('SELECT * FROM permission_requests WHERE session_id=? ORDER BY created_at').all(sessionId) :
      this.database.connection.prepare('SELECT * FROM permission_requests ORDER BY created_at').all()
    return rows.map(row => ({ id: String(row.id), sessionId: String(row.session_id), turnId: String(row.turn_id),
      operationId: String(row.operation_id), capability: String(row.capability), resource: String(row.resource), state: String(row.state),
      details: jsonValue.parse(JSON.parse(String(row.request_json))), createdAt: Number(row.created_at) }))
  }

  granted(request: PermissionRequest): boolean {
    return Boolean(this.database.connection.prepare('SELECT 1 FROM permission_grants WHERE scope=?').get(this.scope(request)))
  }

  finish(request: PermissionRequest, state: string, persistGrant = false, message: string | null = null) {
    return this.database.transaction(() => {
      const result = this.database.connection.prepare('UPDATE permission_requests SET state=? WHERE id=? AND state=?').run(state, request.id, 'pending')
      if (result.changes !== 1) throw new Error('Permission request already resolved')
      if (persistGrant) this.database.connection.prepare('INSERT OR REPLACE INTO permission_grants VALUES (?, ?, ?, ?)')
        .run(this.scope(request), request.sessionId, request.id, Date.now())
      return this.events.insert(request.sessionId, request.turnId, 'permission.resolved', { requestId: request.id, state, persistent: persistGrant, message })
    })
  }

  revoke(request: PermissionRequest): void {
    const event = this.database.transaction(() => {
      this.database.connection.prepare('DELETE FROM permission_grants WHERE scope=?').run(this.scope(request))
      return this.events.insert(request.sessionId, request.turnId, 'permission.grant.revoked', { requestId: request.id })
    })
    this.events.publish(event)
  }

  private scope(request: PermissionRequest): string {
    return permissionScope(request.sessionId, request.capability, request.resource, request.details)
  }
}

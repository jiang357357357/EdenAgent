import { recordRecoveredPermissionDecisions } from './recovery-permissions.ts'
import type { EdenDatabase } from '@eden/store'
import type { PackagePermissionDecision } from '@eden/api'
type Declaration = { capability: string; resource: string; access: string; required: boolean }
const identity = (value: Pick<Declaration, 'capability' | 'resource' | 'access'>) => JSON.stringify([value.capability, value.resource, value.access])
export class PackagePermissionRepository {
  constructor(private readonly database: EdenDatabase) {}
  list(id: string, revision: string) {
    return this.database.connection.prepare('SELECT * FROM plugin_package_grants WHERE id=? AND revision=? ORDER BY capability,resource,access').all(id, revision)
      .map(row => ({ capability: String(row.capability), resource: String(row.resource), access: String(row.access), decision: String(row.decision), revision, updatedAt: Number(row.updated_at) }))
  }
  set(id: string, revision: string, declarations: Declaration[], decisions: PackagePermissionDecision[]) {
    const declared = new Set(declarations.map(identity)), seen = new Set<string>()
    for (const decision of decisions) {
      const key = identity(decision)
      if (!declared.has(key)) throw new Error('Permission decision does not match a declared package permission')
      if (seen.has(key)) throw new Error('Duplicate permission decision')
      seen.add(key)
    }
    this.database.transaction(() => {
      const now = Date.now()
      for (const decision of decisions) this.database.connection.prepare(`INSERT INTO plugin_package_grants VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(id,revision,capability,resource,access) DO UPDATE SET decision=excluded.decision,updated_at=excluded.updated_at`)
        .run(id, revision, decision.capability, decision.resource, decision.access, decision.decision, now)
      recordRecoveredPermissionDecisions(this.database, id, revision, decisions, now)
      if (decisions.some(decision => decision.decision === 'denied')) this.database.connection.prepare('UPDATE plugin_package_selection SET enabled=0 WHERE id=? AND revision=?').run(id, revision)
    })
    return this.list(id, revision)
  }
  require(id: string, revision: string, declarations: Declaration[]) {
    const allowed = new Set(this.list(id, revision).filter(grant => grant.decision === 'allowed').map(identity))
    if (declarations.some(declaration => declaration.required && !allowed.has(identity(declaration)))) throw new Error('Required package permissions have not been granted for this revision')
  }
  allowed(id: string, revision: string, permission: Pick<Declaration, 'capability' | 'resource' | 'access'>): boolean {
    return this.list(id, revision).some(grant => grant.decision === 'allowed' && identity(grant) === identity(permission))
  }
}

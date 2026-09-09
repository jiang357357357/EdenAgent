import { randomUUID, createHash } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import type { RoleImportEntry } from '@eden/api'
import { roleImportPreviewSchema } from '@eden/api'
import { SubagentRoleRepository } from './role-repository.ts'

interface Planned { entry: RoleImportEntry; root: string; revision: string | null }
export class SubagentRoleImport {
  constructor(private readonly database: EdenDatabase, private readonly roles: SubagentRoleRepository) {}
  preview(raw: unknown) {
    const { entries } = roleImportPreviewSchema.parse(raw)
    if (Buffer.byteLength(JSON.stringify(entries)) > 512 * 1024) throw new Error('Role import batch exceeds 512 KiB; select fewer roles')
    const seen = new Set<string>()
    const plan: Planned[] = entries.map(entry => {
      if (createHash('sha256').update(entry.originalToml).digest('hex') !== entry.sha256) throw new Error('Role source digest mismatch')
      const root = this.roles.target(entry.scope), key = JSON.stringify([root, entry.definition.name])
      if (seen.has(key)) throw new Error('Batch contains duplicate role names in the same scope')
      seen.add(key)
      return { entry, root, revision: this.roles.revision(entry.definition.name, entry.scope) }
    })
    const previewId = randomUUID(), expiresAt = Date.now() + 15 * 60000
    this.database.transaction(() => {
      const db = this.database.connection
      db.prepare("DELETE FROM subagent_role_imports WHERE state='preview' AND expires_at<?").run(Date.now())
      if (Number(db.prepare("SELECT COUNT(*) AS n FROM subagent_role_imports WHERE state='preview'").get()?.n) >= 16) throw new Error('Too many role import previews')
      db.prepare("INSERT INTO subagent_role_imports VALUES(?,?,'preview',?,NULL,NULL)").run(previewId, JSON.stringify(plan), expiresAt)
    })
    return { previewId, expiresAt, items: plan.map(({ entry, root, revision }) => ({ name: entry.definition.name, scope: entry.scope,
      workspaceRoot: root, replaces: revision !== null, source: entry.source, sha256: entry.sha256, definition: entry.definition })) }
  }
  apply(previewId: string) {
    return this.database.transaction(() => {
      const db = this.database.connection, row = db.prepare('SELECT * FROM subagent_role_imports WHERE id=?').get(previewId)
      if (!row) throw new Error('Role import preview not found')
      if (row.state === 'applied') return JSON.parse(String(row.result_json)) as { previewId: string; count: number }
      if (Number(row.expires_at) < Date.now()) throw new Error('Role import preview expired')
      const plan = JSON.parse(String(row.plan_json)) as Planned[]
      for (const item of plan) this.roles.saveInTransaction(item.entry.definition, item.revision, item.entry.scope, item.root)
      const result = { previewId, count: plan.length }
      db.prepare("UPDATE subagent_role_imports SET state='applied',result_json=?,applied_at=? WHERE id=?").run(JSON.stringify(result), Date.now(), previewId)
      return result
    })
  }
}

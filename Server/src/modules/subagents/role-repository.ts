import { randomUUID } from 'node:crypto'
import { subagentRoleDefinitionSchema } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { SubagentRoleDefinition } from '@eden/api'
import { subagentRoles, subagentRole } from './role-catalog.ts'

export class SubagentRoleRepository {
  constructor(private readonly database: EdenDatabase, private readonly workspace: () => string = () => '') {}
  target(scope: 'user' | 'project'): string {
    if (scope === 'user') return ''
    const root = this.workspace()
    if (!root) throw new Error('Select a workspace before configuring project roles')
    return root
  }
  private exact(name: string, root: string) {
    return root ? this.database.connection.prepare('SELECT definition_json,revision FROM subagent_project_roles WHERE workspace_root=? AND name=?').get(root, name) :
      this.database.connection.prepare('SELECT definition_json,revision FROM subagent_roles WHERE name=?').get(name)
  }
  read(name: string, scope?: 'user' | 'project') {
    const root = scope === 'user' ? '' : this.workspace(), project = root ? this.exact(name, root) : undefined
    const row = project ?? this.exact(name, '')
    return row ? { ...subagentRoleDefinitionSchema.parse(JSON.parse(String(row.definition_json))), revision: String(row.revision),
      source: project ? 'project' as const : 'user' as const, workspaceRoot: project ? root : '' } :
      { ...subagentRoleDefinitionSchema.parse(subagentRole(name)), revision: null, source: 'builtin' as const, workspaceRoot: '' }
  }
  edit(name: string, scope: 'user' | 'project') {
    const workspaceRoot = this.target(scope), current = this.exact(name, workspaceRoot)
    return { definition: this.read(name, scope), scope, workspaceRoot, expectedRevision: current ? String(current.revision) : null }
  }
  list() {
    const names = new Set<string>(subagentRoles().map(role => role.name))
    for (const row of this.database.connection.prepare('SELECT name FROM subagent_roles ORDER BY name').all()) names.add(String(row.name))
    const root = this.workspace()
    if (root) for (const row of this.database.connection.prepare('SELECT name FROM subagent_project_roles WHERE workspace_root=?').all(root)) names.add(String(row.name))
    return [...names].sort().map(name => this.read(name))
  }
  remove(name: string, scope: 'user' | 'project', expectedWorkspaceRoot: string, expectedRevision: string) {
    return this.database.transaction(() => {
      const root = this.target(scope)
      if (root !== expectedWorkspaceRoot) throw new Error('Workspace changed; reload before removing a role')
      const db = this.database.connection, current = this.exact(name, root)
      if (!current) return { name, deleted: false }
      if (current.revision !== expectedRevision) throw new Error('Role changed; reload before removing it')
      db.prepare('INSERT INTO subagent_role_history(revision,name,previous_json,definition_json,created_at,workspace_root) VALUES(?,?,?,?,?,?)')
        .run(randomUUID(), name, current.definition_json!, 'null', Date.now(), root)
      if (root) db.prepare('DELETE FROM subagent_project_roles WHERE workspace_root=? AND name=?').run(root, name)
      else db.prepare('DELETE FROM subagent_roles WHERE name=?').run(name)
      return { name, deleted: true }
    })
  }
  revision(name: string, scope: 'user' | 'project') {
    const row = this.exact(name, this.target(scope))
    return row ? String(row.revision) : null
  }
  save(raw: SubagentRoleDefinition, expectedRevision: string | null, scope: 'user' | 'project' = 'user', expectedWorkspaceRoot = '') {
    return this.database.transaction(() => this.saveInTransaction(raw, expectedRevision, scope, expectedWorkspaceRoot))
  }
  saveInTransaction(raw: SubagentRoleDefinition, expectedRevision: string | null, scope: 'user' | 'project', expectedWorkspaceRoot: string) {
    if (!this.database.inTransaction) throw new Error('Role batch requires an owning transaction')
    const definition = subagentRoleDefinitionSchema.parse(raw)
    const root = this.target(scope)
    if (root !== expectedWorkspaceRoot) throw new Error('Workspace changed; reload before saving project roles')
    const db = this.database.connection, current = this.exact(definition.name, root)
    if ((current ? String(current.revision) : null) !== expectedRevision) throw new Error('Role configuration changed; reload before saving')
    const count = root ? db.prepare('SELECT COUNT(*) AS n FROM subagent_project_roles WHERE workspace_root=?').get(root) : db.prepare('SELECT COUNT(*) AS n FROM subagent_roles').get()
    if (!current && Number(count?.n) >= 256) throw new Error('Custom role limit reached')
    const revision = randomUUID(), now = Date.now(), serialized = JSON.stringify(definition)
    db.prepare('INSERT INTO subagent_role_history(revision,name,previous_json,definition_json,created_at,workspace_root) VALUES(?,?,?,?,?,?)').run(revision, definition.name, current?.definition_json ?? null, serialized, now, root)
    if (root) db.prepare(`INSERT INTO subagent_project_roles VALUES(?,?,?,?,?) ON CONFLICT(workspace_root,name) DO UPDATE SET
      definition_json=excluded.definition_json,revision=excluded.revision,updated_at=excluded.updated_at`).run(root, definition.name, serialized, revision, now)
    else db.prepare(`INSERT INTO subagent_roles VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET definition_json=excluded.definition_json,revision=excluded.revision,updated_at=excluded.updated_at`)
      .run(definition.name, serialized, revision, now)
    return this.read(definition.name, scope)
  }
}

import type { EdenDatabase } from '@eden/store'
import { VersionRepository } from '../installation/version-repository.ts'
import { workspaceScope } from './workspace-scope.ts'

export interface ActivePlugin { id: string; revision: string; readRoot: string | undefined }

export class ActivationRepository {
  constructor(private readonly database: EdenDatabase, private readonly versions: VersionRepository,
    private readonly protectedRoots: readonly string[] = []) {}

  grant(id: string, revision: string, readRoot: string, allowed: boolean): void {
    this.versions.read(id, revision)
    const resource = workspaceScope(readRoot, this.protectedRoots)
    this.database.connection.prepare('INSERT OR REPLACE INTO plugin_grants VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, revision, resource, allowed ? 'allow' : 'deny', 'user', Date.now())
    if (!allowed) this.disable(id)
  }

  activate(id: string, revision: string, readRoot?: string): ActivePlugin {
    const resource = this.assertScope(id, revision, readRoot)
    this.database.connection.prepare('INSERT OR REPLACE INTO plugin_activations VALUES (?, ?, ?, ?)').run(id, revision, 1, resource ?? null)
    return { id, revision, readRoot: resource }
  }

  assertScope(id: string, revision: string, readRoot?: string): string | undefined {
    const plugin = this.versions.read(id, revision)
    const resource = readRoot ? workspaceScope(readRoot, this.protectedRoots) : undefined
    if (plugin.manifest.permissions.length) {
      if (!resource) throw new Error('Plugin requires an explicitly granted workspace root')
      const grant = this.database.connection.prepare('SELECT decision FROM plugin_grants WHERE plugin_id=? AND revision=? AND resource=?').get(id, revision, resource)
      if (grant?.decision !== 'allow') throw new Error('Plugin workspace access requires user authorization for this revision')
    } else if (resource) throw new Error('Plugin did not declare workspace.read')
    return resource
  }

  disable(id: string): void {
    this.database.connection.prepare('UPDATE plugin_activations SET enabled=0 WHERE plugin_id=?').run(id)
  }

  list(): ActivePlugin[] {
    return this.database.connection.prepare('SELECT * FROM plugin_activations WHERE enabled=1').all().map(row => ({
      id: String(row.plugin_id), revision: String(row.revision), readRoot: row.read_root === null ? undefined : String(row.read_root),
    }))
  }
}

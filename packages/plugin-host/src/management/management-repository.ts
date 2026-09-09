import { replacementDiff } from './version-diff.ts'
import type { EdenDatabase } from '@eden/store'
import { pluginManifestSchema } from '@eden/plugin-sdk'
import type { VersionRepository } from '../installation/version-repository.ts'

export class PluginManagementRepository {
  constructor(private readonly database: EdenDatabase, private readonly versions: VersionRepository) {}
  list() {
    const ids = this.database.connection.prepare('SELECT DISTINCT plugin_id FROM plugin_versions ORDER BY plugin_id').all()
    return ids.map(row => this.read(String(row.plugin_id)))
  }
  read(id: string) {
    const rows = this.database.connection.prepare('SELECT * FROM plugin_versions WHERE plugin_id=? ORDER BY created_at DESC,revision').all(id)
    if (!rows.length) throw new Error('Plugin is not installed')
    const activation = this.database.connection.prepare('SELECT * FROM plugin_activations WHERE plugin_id=?').get(id)
    const selected = rows.find(row => row.revision === activation?.revision) ?? rows[0]!
    const manifest = pluginManifestSchema.parse(JSON.parse(String(selected.manifest_json)))
    const revision = String(selected.revision)
    const grants = this.database.connection.prepare('SELECT * FROM plugin_grants WHERE plugin_id=? AND revision=?').all(id, revision)
    return { id, name: manifest.name, description: manifest.description, version: manifest.version, revision,
      enabled: Boolean(activation?.enabled), trustState: 'local:tested', sourceType: 'generated', sourceUri: '',
      components: [{ id: manifest.tool.name, kind: 'tool', path: manifest.entry, enabledByDefault: true }], uiContributions: [],
      permissions: manifest.permissions.map(permission => ({ ...permission, resource: String(activation?.read_root ?? ''), access: 'read', required: true })),
      permissionGrants: grants.map(row => ({ capability: 'workspace.read', resource: String(row.resource), access: 'read',
        decision: row.decision === 'allow' ? 'allowed' : 'denied', revision, updatedAt: Number(row.created_at ?? 0) })),
      versions: rows.map(row => ({ version: String(row.version), revision: String(row.revision), active: Boolean(activation?.enabled) && row.revision === activation?.revision,
        trustState: 'local:tested', sourceType: 'generated', sourceUri: '', installedAt: Number(row.created_at) })),
      manifest, createdAt: Number(rows.at(-1)!.created_at), updatedAt: Number(selected.created_at) }
  }
  drafts() {
    return this.database.connection.prepare('SELECT id,manifest_json,updated_at FROM plugin_drafts ORDER BY updated_at DESC').all().map(row => {
      const manifest = pluginManifestSchema.parse(JSON.parse(String(row.manifest_json)))
      return { id: String(row.id), name: manifest.name, version: manifest.version, updatedAt: Number(row.updated_at) }
    })
  }
  version(id: string, revision: string) {
    const value = this.versions.read(id, revision)
    return { manifest: value.manifest, source: value.source, revision: value.revision, report: value.report }
  }
  diff(id: string, fromRevision: string, toRevision: string) {
    const before = this.versions.read(id, fromRevision), after = this.versions.read(id, toRevision)
    return { id, fromRevision, toRevision, source: replacementDiff(before.source, after.source),
      manifest: replacementDiff(JSON.stringify(before.manifest, null, 2), JSON.stringify(after.manifest, null, 2)) }
  }
  remove(id: string) {
    return this.database.transaction(() => {
      this.database.connection.prepare('DELETE FROM plugin_activations WHERE plugin_id=?').run(id)
      this.database.connection.prepare('DELETE FROM plugin_grants WHERE plugin_id=?').run(id)
      const removed = this.database.connection.prepare('DELETE FROM plugin_versions WHERE plugin_id=?').run(id).changes
      this.database.connection.prepare('DELETE FROM plugin_test_reports WHERE plugin_id=?').run(id)
      const drafts = this.database.connection.prepare('DELETE FROM plugin_drafts WHERE id=?').run(id).changes
      return { id, deleted: Number(removed) + Number(drafts) > 0, removedVersions: Number(removed), cleanupErrors: [] }
    })
  }
}

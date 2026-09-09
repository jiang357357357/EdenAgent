import { packageNativePlans } from './native-plan.ts'
import { assertPackageHostVersion } from './host-version.ts'
import { PackagePermissionRepository } from './permission-repository.ts'
import { packageRuntimeDescriptors } from './runtime-descriptors.ts'
import type { PackagePermissionDecision } from '@eden/api'
import { packageUiCards, packageSkillSnapshots } from './components.ts'
import type { EdenDatabase } from '@eden/store'
import { componentSummary, packageManifestSchema } from './manifest.ts'
import type { PackagePreviewRepository } from './preview-repository.ts'
import type { MarketRepository } from '../repository.ts'
import { verifyPackageFiles } from './integrity.ts'
type Preview = ReturnType<PackagePreviewRepository['read']>
export class InstalledPackageRepository {
  readonly permissions: PackagePermissionRepository
  constructor(private readonly database: EdenDatabase, private readonly market: MarketRepository) { this.permissions = new PackagePermissionRepository(database) }
  has(id: string) { return Boolean(this.database.connection.prepare('SELECT 1 FROM plugin_packages WHERE id=? LIMIT 1').get(id)) }
  install(preview: Preview, select: boolean, enabled: boolean) {
    if (enabled) throw new Error('Package component activation must be completed separately')
    this.market.assertNotHistoricallyRevoked(preview.manifest.id, preview.manifest.version, preview.revision)
    assertPackageHostVersion(preview.manifest.minHostVersion, preview.manifest.maxHostVersion)
    return this.database.transaction(() => {
      if (this.database.connection.prepare('SELECT 1 FROM plugin_versions WHERE plugin_id=? UNION SELECT 1 FROM plugin_drafts WHERE id=? LIMIT 1').get(preview.manifest.id, preview.manifest.id)) throw new Error('Plugin ID is already used by a TypeScript plugin')
      const now = Date.now()
      this.database.connection.prepare(`INSERT OR IGNORE INTO plugin_packages(id,revision,manifest_json,files_json,provenance_json,key_id,installed_at)
        VALUES(?,?,?,?,?,?,?)`).run(preview.manifest.id, preview.revision, JSON.stringify(preview.manifest),
          JSON.stringify(Object.fromEntries([...preview.files].map(([name, bytes]) => [name, bytes.toString('base64')]))), JSON.stringify(preview.provenance), preview.keyId, now)
      const current = this.database.connection.prepare('SELECT 1 FROM plugin_package_selection WHERE id=?').get(preview.manifest.id)
      if (select || !current) this.database.connection.prepare('INSERT INTO plugin_package_selection(id,revision,enabled) VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,enabled=0').run(preview.manifest.id, preview.revision)
      this.database.connection.prepare('DELETE FROM plugin_package_previews WHERE id=?').run(preview.previewID)
      this.database.connection.prepare("UPDATE legacy_plugin_history SET state='installed_disabled' WHERE domain='plugin_versions' AND source_id=? AND state='files_copied_review_required'")
        .run(JSON.stringify([preview.manifest.id, preview.manifest.version, preview.revision]))
      return this.read(preview.manifest.id)
    })
  }
  list() { return this.database.connection.prepare('SELECT DISTINCT id FROM plugin_packages ORDER BY id').all().map(row => this.read(String(row.id))) }
  read(id: string) {
    const rows = this.database.connection.prepare('SELECT * FROM plugin_packages WHERE id=? ORDER BY installed_at DESC,revision').all(id)
    const selected = this.database.connection.prepare('SELECT * FROM plugin_package_selection WHERE id=?').get(id)
    const row = rows.find(item => item.revision === selected?.revision) ?? rows[0]
    if (!row) throw new Error('Plugin package not installed')
    const manifest = packageManifestSchema.parse(JSON.parse(String(row.manifest_json))), provenance = JSON.parse(String(row.provenance_json)) as Preview['provenance']
    let trustState = this.trust(String(row.key_id))
    let uiContributions: ReturnType<typeof packageUiCards> = []
    if (selected?.enabled && (trustState.startsWith('verified:') || trustState === 'unsigned:local')) {
      try { uiContributions = this.componentPlan(id, String(row.revision)).ui }
      catch { trustState = 'blocked:component-unavailable' }
    }
    return { id, name: manifest.name, description: manifest.description, version: manifest.version, revision: String(row.revision), enabled: Boolean(selected?.enabled) && (trustState.startsWith('verified:') || trustState === 'unsigned:local'),
      trustState, sourceType: provenance.sourceType ?? 'marketplace', sourceUri: provenance.sourceUri ?? `market:${provenance.sourceId}/${id}@${manifest.version}#${String(row.revision)}`,
      components: componentSummary(manifest).map(component => ({ ...component, enabled: this.componentEnabled(id, String(row.revision), component.id, component.enabledByDefault) })), uiContributions, permissions: manifest.permissions, permissionGrants: this.permissions.list(id, String(row.revision)),
      versions: rows.map(item => ({ version: packageManifestSchema.parse(JSON.parse(String(item.manifest_json))).version, revision: String(item.revision),
        active: item.revision === selected?.revision, trustState: this.trust(String(item.key_id)), sourceType: (JSON.parse(String(item.provenance_json)) as Preview['provenance']).sourceType ?? 'marketplace', sourceUri: (JSON.parse(String(item.provenance_json)) as Preview['provenance']).sourceUri ?? '', installedAt: Number(item.installed_at) })),
      manifest, createdAt: Number(rows.at(-1)!.installed_at), updatedAt: Number(row.installed_at) }
  }
  private componentEnabled(id: string, revision: string, componentId: string, fallback: boolean): boolean {
    const row = this.database.connection.prepare('SELECT enabled FROM plugin_package_components WHERE id=? AND revision=? AND component_id=?').get(id, revision, componentId)
    return row ? Boolean(row.enabled) : fallback
  }
  private componentPlan(id: string, revision: string) {
    const value = this.verified(id, revision), enabled = (componentId: string, fallback: boolean) => this.componentEnabled(id, revision, componentId, fallback)
    this.permissions.require(id, revision, value.manifest.permissions)
    // Validate native executable ownership before any activation decision; the connector launcher remains separate.
    packageNativePlans(value, enabled)
    const runtimes = packageRuntimeDescriptors(value, enabled)
    for (const runtime of runtimes) {
      if (!this.permissions.allowed(id, revision, runtime.permission)) throw new Error('MCP runtime requires an explicit command or endpoint grant')
    }
    const skills = packageSkillSnapshots(value, enabled)
    for (const hook of value.manifest.components.hooks) if (enabled(hook.id, hook.enabledByDefault) && !skills.some(skill => skill.componentId === hook.skill)) throw new Error('Hook target skill must be enabled')
    return { ui: packageUiCards(value, enabled), skills }
  }
  runtimePlan(id: string, revision: string) {
    const value = this.verified(id, revision)
    this.permissions.require(id, revision, value.manifest.permissions)
    const runtimes = packageRuntimeDescriptors(value, (componentId, fallback) => this.componentEnabled(id, revision, componentId, fallback))
    for (const runtime of runtimes) if (!this.permissions.allowed(id, revision, runtime.permission)) throw new Error('MCP runtime permission is missing for this version')
    return { runtimes, files: value.files }
  }
  nativePlan(id: string, revision: string) {
    const value = this.verified(id, revision)
    this.permissions.require(id, revision, value.manifest.permissions)
    return packageNativePlans(value, (componentId, fallback) => this.componentEnabled(id, revision, componentId, fallback))
  }
  nativeSelectionPlans() {
    return this.runtimeSelections().map(selection => {
      try { return { id: selection.id, revision: selection.revision, plans: this.nativePlan(selection.id, selection.revision), error: null } }
      catch { return { id: selection.id, revision: selection.revision, plans: [], error: 'Native package integrity, platform executable or permissions are unavailable' } }
    })
  }
  runtimeSelections() {
    return this.database.connection.prepare('SELECT id,revision FROM plugin_package_selection WHERE enabled=1').all()
      .map(row => ({ id: String(row.id), revision: String(row.revision) }))
  }
  setPermissions(id: string, revision: string, decisions: PackagePermissionDecision[]) {
    const row = this.database.connection.prepare('SELECT manifest_json FROM plugin_packages WHERE id=? AND revision=?').get(id, revision)
    if (!row) throw new Error('Plugin package version not found')
    // Denial remains possible even after a key is revoked; only new grants require current integrity.
    if (decisions.some(decision => decision.decision === 'allowed')) this.verified(id, revision)
    const manifest = packageManifestSchema.parse(JSON.parse(String(row.manifest_json)))
    this.permissions.set(id, revision, manifest.permissions, decisions)
    return this.read(id)
  }
  enable(id: string) {
    const current = this.read(id)
    this.componentPlan(id, current.revision)
    this.database.connection.prepare('UPDATE plugin_package_selection SET enabled=1,enabled_after_rowid=(SELECT COALESCE(MAX(rowid),0) FROM events) WHERE id=? AND revision=?').run(id, current.revision)
    return this.read(id)
  }
  setComponent(id: string, revision: string, componentId: string, enabled: boolean) {
    const value = this.verified(id, revision)
    if (!componentSummary(value.manifest).some(item => item.id === componentId)) throw new Error('Plugin component not found')
    this.database.transaction(() => {
      this.database.connection.prepare('INSERT INTO plugin_package_components VALUES(?,?,?,?) ON CONFLICT(id,revision,component_id) DO UPDATE SET enabled=excluded.enabled').run(id, revision, componentId, Number(enabled))
      const active = this.database.connection.prepare('SELECT enabled,revision FROM plugin_package_selection WHERE id=?').get(id)
      if (active?.enabled && active.revision === revision) {
        this.componentPlan(id, revision)
        this.database.connection.prepare('UPDATE plugin_package_selection SET enabled_after_rowid=(SELECT COALESCE(MAX(rowid),0) FROM events) WHERE id=?').run(id)
      }
    })
    return this.read(id)
  }
  hookContributions() {
    const active = this.database.connection.prepare('SELECT id,revision,enabled_after_rowid FROM plugin_package_selection WHERE enabled=1').all()
    return active.flatMap(row => {
      try {
        const id = String(row.id), revision = String(row.revision), plan = this.componentPlan(id, revision), value = this.verified(id, revision)
        return value.manifest.components.hooks.filter(hook => this.componentEnabled(id, revision, hook.id, hook.enabledByDefault)).map(hook => {
          const skill = plan.skills.find(item => item.componentId === hook.skill)
          if (!skill) throw new Error('Hook target skill is not enabled')
          return { pluginId: id, revision, hookId: hook.id, event: hook.event, skillName: skill.snapshot.name, afterRowid: Number(row.enabled_after_rowid) }
        })
      } catch { return [] }
    })
  }
  skillContributions() {
    const active = this.database.connection.prepare('SELECT id,revision FROM plugin_package_selection WHERE enabled=1').all()
    return active.flatMap(row => {
      try { return this.componentPlan(String(row.id), String(row.revision)).skills }
      catch { return [] }
    })
  }
  select(id: string, revision: string) {
    this.verified(id, revision)
    this.database.connection.prepare('INSERT INTO plugin_package_selection(id,revision,enabled) VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,enabled=0').run(id, revision)
    return this.read(id)
  }
  disable(id: string) { this.database.connection.prepare('UPDATE plugin_package_selection SET enabled=0 WHERE id=?').run(id); return this.read(id) }
  remove(id: string) {
    return this.database.transaction(() => {
      this.database.connection.prepare('DELETE FROM plugin_package_grants WHERE id=?').run(id)
      this.database.connection.prepare('DELETE FROM plugin_package_components WHERE id=?').run(id)
      this.database.connection.prepare('DELETE FROM plugin_package_selection WHERE id=?').run(id)
      const result = this.database.connection.prepare('DELETE FROM plugin_packages WHERE id=?').run(id)
      return { id, deleted: Number(result.changes) > 0, removedVersions: Number(result.changes), cleanupErrors: [] }
    })
  }
  verified(id: string, revision: string) {
    const row = this.database.connection.prepare('SELECT * FROM plugin_packages WHERE id=? AND revision=?').get(id, revision)
    if (!row) throw new Error('Package version is not installed')
    const encoded: Record<string, string> = JSON.parse(String(row.files_json))
    const files = new Map(Object.entries(encoded).map(([name, bytes]) => [name, Buffer.from(bytes, 'base64')]))
    const provenance: Preview['provenance'] = JSON.parse(String(row.provenance_json))
    const result = verifyPackageFiles(files, key => this.market.key(key), provenance.sourceType === 'local' && row.key_id === '')
    if (result.revision !== revision || result.keyId !== row.key_id) throw new Error('Installed package integrity mismatch')
    const manifest = packageManifestSchema.parse(result.manifest)
    this.market.assertNotHistoricallyRevoked(id, manifest.version, revision)
    assertPackageHostVersion(manifest.minHostVersion, manifest.maxHostVersion)
    return { ...result, manifest, files }
  }
  private trust(id: string) { if (!id) return 'unsigned:local'; try { this.market.key(id); return `verified:${id}` } catch { return 'blocked:signing-key-revoked' } }
}

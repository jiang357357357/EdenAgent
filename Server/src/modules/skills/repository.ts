import { randomUUID } from 'node:crypto'
import type { SQLOutputValue } from 'node:sqlite'
import type { EdenDatabase } from '@eden/store'
import type { SkillSnapshot } from './snapshot.ts'
import { skillAvailability, type SkillCapabilities } from './availability.ts'
export interface SkillSource { type: string; uri: string; ref: string; subpath: string }
type Expected = { expectedContentHash?: string | undefined; expectedWorkspaceRoot?: string | undefined }
export interface ContributedSkill { pluginId: string; revision: string; componentId: string; snapshot: SkillSnapshot }
type Row = Record<string, SQLOutputValue>
export class SkillRepository {
  constructor(private readonly database: EdenDatabase, private readonly workspace: () => string = () => '', private readonly contributions: () => ContributedSkill[] = () => [],
    private readonly capabilities: () => SkillCapabilities = () => ({ tools: [], codeToolsAvailable: false }),
    private readonly systemSkills: () => readonly SkillSnapshot[] = () => [],
    private readonly projectSkills: () => readonly SkillSnapshot[] = () => []) {}
  target(scope: string): string {
    if (scope === 'user') return ''
    if (scope !== 'project') throw new Error('Unsupported skill scope')
    const root = this.workspace()
    if (!root) throw new Error('Select a workspace before installing project skills')
    return root
  }
  preview(data: SkillSnapshot, source: SkillSource, scope: string, root = this.target(scope)) {
    if (root !== this.target(scope)) throw new Error('Workspace changed while inspecting skill; inspect again')
    const id = randomUUID(), expires = Date.now() + 15 * 60000
    this.database.transaction(() => {
      this.database.connection.prepare('DELETE FROM skill_previews WHERE expires_at<?').run(Date.now())
      if (Number(this.database.connection.prepare('SELECT COUNT(*) AS n FROM skill_previews').get()?.n) >= 32) throw new Error('Too many pending skill previews')
      this.database.connection.prepare(`INSERT INTO skill_previews(id,snapshot_json,source_json,scope,expires_at,previous_hash,workspace_root)
        VALUES(?,?,?,?,?,?,?)`).run(id, JSON.stringify(data), JSON.stringify(source), scope, expires, this.hash(data.name, root), root)
    })
    return { previewID: id, skillName: data.name, displayName: data.displayName, description: data.description, version: data.version,
      scope, workspaceRoot: root, source, tools: data.tools, profiles: data.profiles, modelInvocable: data.modelInvocable, contentHash: data.contentHash,
      fileCount: Object.keys(data.files).length, totalBytes: data.totalBytes, expiresAt: expires }
  }
  install(previewId: string) {
    return this.database.transaction(() => {
      const row = this.database.connection.prepare('SELECT * FROM skill_previews WHERE id=?').get(previewId)
      if (!row || Number(row.expires_at) < Date.now()) throw new Error('Skill preview expired; inspect the source again')
      const root = String(row.workspace_root)
      if (root !== this.target(String(row.scope))) throw new Error('Skill preview belongs to another workspace; inspect again')
      const data: SkillSnapshot = JSON.parse(String(row.snapshot_json))
      if (this.hash(data.name, root) !== row.previous_hash) throw new Error('Skill changed since preview; inspect again')
      this.database.connection.prepare(`INSERT INTO installed_skills(name,workspace_root,snapshot_json,source_json,scope,enabled,updated_at)
        VALUES(?,?,?,?,?,1,?) ON CONFLICT(name,workspace_root) DO UPDATE SET
        snapshot_json=excluded.snapshot_json,source_json=excluded.source_json,updated_at=excluded.updated_at`)
        .run(data.name, root, row.snapshot_json!, row.source_json!, row.scope!, Date.now())
      this.database.connection.prepare('DELETE FROM skill_previews WHERE id=?').run(previewId)
      return this.describe(this.exact(data.name, root)!, true)
    })
  }
  discardPreview(previewId: string) {
    this.database.connection.prepare('DELETE FROM skill_previews WHERE id=?').run(previewId)
  }
  list(withCapabilities = true) {
    const root = this.workspace()
    const rows = this.database.connection.prepare(`SELECT * FROM installed_skills WHERE workspace_root='' OR workspace_root=?
      ORDER BY name,CASE WHEN workspace_root='' THEN 1 ELSE 0 END`).all(root)
    const seen = new Set<string>()
    return [...rows.filter(row => row.workspace_root !== ''), ...this.discoveredProjectRows(), ...rows.filter(row => row.workspace_root === ''), ...this.contributedRows(), ...this.systemRows()].filter(row => { const name = String(row.name); if (seen.has(name)) return false; seen.add(name); return true })
      .map(row => this.describe(row, false, withCapabilities))
  }
  read(name: string, includeContent = true, expected: Expected = {}) {
    const row = this.resolve(name)
    this.assertExpected(row, expected)
    return this.describe(row, includeContent)
  }
  executionSnapshot(name: string): SkillSnapshot {
    const row = this.resolve(name), data: SkillSnapshot = JSON.parse(String(row.snapshot_json))
    if (!row.enabled || !data.modelInvocable) throw new Error('Skill execution is disabled')
    return data
  }
  toolDependencies(name: string) {
    const row = this.resolve(name), data: SkillSnapshot = JSON.parse(String(row.snapshot_json))
    const capabilities = this.capabilities(), host = new Set(capabilities.tools)
    const local = new Set(capabilities.codeToolsAvailable ? (data.codeTools ?? []).map(tool => tool.name) : [])
    return data.tools.map(tool => ({ name: tool, alternatives: [
      ...(host.has(tool) ? [tool] : []), ...(local.has(tool) && host.has('run_skill_tool') ? [tool, 'run_skill_tool'] : []),
    ] }))
  }
  file(name: string, filename: string, expected: Expected = {}) {
    const row = this.resolve(name)
    this.assertExpected(row, expected)
    const data: SkillSnapshot = JSON.parse(String(row.snapshot_json))
    if (!Object.hasOwn(data.files, filename)) throw new Error('File is not in the installed skill snapshot')
    return { name, path: filename, encoding: 'base64', content: data.files[filename], contentHash: data.contentHash }
  }
  enable(name: string, enabled: boolean, expected: Expected = {}) {
    const row = this.resolve(name)
    if (row.contributed) throw new Error('Manage this skill through its owning plugin component')
    this.assertExpected(row, expected)
    if (row.builtin) {
      this.database.connection.prepare('INSERT OR REPLACE INTO runtime_settings(key,value_json,updated_at) VALUES(?,?,?)')
        .run(this.discoveredEnabledKey(row), JSON.stringify(enabled), Date.now())
      return this.read(name)
    }
    this.database.connection.prepare('UPDATE installed_skills SET enabled=?,updated_at=? WHERE name=? AND workspace_root=?')
      .run(Number(enabled), Date.now(), name, row.workspace_root!)
    return this.read(name)
  }
  uninstall(name: string, expected: Expected = {}) {
    const row = this.resolve(name)
    if (row.contributed) throw new Error('Manage this skill through its owning plugin component')
    if (row.builtin) throw new Error('Discovered skills cannot be uninstalled; disable the skill or remove its source directory')
    this.assertExpected(row, expected)
    return { name, deleted: this.database.connection.prepare('DELETE FROM installed_skills WHERE name=? AND workspace_root=?').run(name, row.workspace_root!).changes > 0 }
  }
  private assertExpected(row: Row, expected: Expected) {
    const data: SkillSnapshot = JSON.parse(String(row.snapshot_json))
    if ((expected.expectedContentHash !== undefined && expected.expectedContentHash !== data.contentHash)
      || (expected.expectedWorkspaceRoot !== undefined && expected.expectedWorkspaceRoot !== row.workspace_root)) {
      throw new Error('Displayed skill or workspace changed; refresh before changing it')
    }
  }
  private resolve(name: string): Row {
    const root = this.workspace(), row = (root ? this.exact(name, root) : undefined) ?? this.discoveredProjectRows().find(item => item.name === name) ?? this.exact(name, '') ?? this.contributedRows().find(item => item.name === name) ?? this.systemRows().find(item => item.name === name)
    if (!row) throw new Error('Skill not installed in this world and workspace')
    return row
  }
  private contributedRows(): Row[] {
    const names = new Set<string>()
    return this.contributions().sort((a, b) => a.pluginId.localeCompare(b.pluginId)).map(item => {
      if (names.has(item.snapshot.name)) throw new Error('Enabled plugin skill names conflict; disable a conflicting component')
      names.add(item.snapshot.name)
      return { name: item.snapshot.name, workspace_root: `@plugin/${item.pluginId}/${item.revision}`, snapshot_json: JSON.stringify(item.snapshot),
        source_json: JSON.stringify({ type: 'marketplace', uri: `plugin:${item.pluginId}`, ref: item.revision, subpath: item.componentId }), scope: 'system', enabled: 1, contributed: 1 }
    })
  }
  private discoveredEnabledKey(row: Row) {
    return row.scope === 'project' ? `skill.project.enabled:${JSON.stringify([row.workspace_root, row.name])}` : `skill.system.enabled:${row.name}`
  }
  private discoveredProjectRows(): Row[] {
    const root = this.workspace()
    return this.projectSkills().map(data => {
      const row: Row = { name: data.name, workspace_root: root, snapshot_json: JSON.stringify(data),
        source_json: JSON.stringify({ type: 'local', uri: '', ref: data.contentHash, subpath: '' }), scope: 'project', enabled: 1, builtin: 1 }
      const saved = this.database.connection.prepare('SELECT value_json FROM runtime_settings WHERE key=?').get(this.discoveredEnabledKey(row))
      if (saved) {
        const enabled: unknown = JSON.parse(String(saved.value_json))
        if (typeof enabled !== 'boolean') throw new Error('Invalid project skill enabled state')
        row.enabled = Number(enabled)
      }
      return row
    })
  }
  private systemRows(): Row[] {
    return this.systemSkills().map(data => {
      const saved = this.database.connection.prepare('SELECT value_json FROM runtime_settings WHERE key=?').get(`skill.system.enabled:${data.name}`)
      const enabled: unknown = saved ? JSON.parse(String(saved.value_json)) : true
      if (typeof enabled !== 'boolean') throw new Error('Invalid persisted system skill enabled state')
      return { name: data.name, workspace_root: '@system', snapshot_json: JSON.stringify(data),
        source_json: JSON.stringify({ type: 'builtin', uri: '', ref: data.contentHash, subpath: '' }), scope: 'system', enabled: Number(enabled), builtin: 1 }
    })
  }
  private exact(name: string, root: string) { return this.database.connection.prepare('SELECT * FROM installed_skills WHERE name=? AND workspace_root=?').get(name, root) }
  private describe(row: Row, includeContent: boolean, withCapabilities = true) {
    const data: SkillSnapshot = JSON.parse(String(row.snapshot_json)), source: SkillSource = JSON.parse(String(row.source_json))
    return { ...data, files: Object.keys(data.files), content: includeContent ? data.content : null, enabled: Boolean(row.enabled),
      ...(withCapabilities ? skillAvailability(data, this.capabilities()) : { available: false, missingTools: [] }), scope: String(row.scope), workspaceRoot: String(row.workspace_root), sourceType: source.type, manifest: { source, discovered: Boolean(row.builtin), workspaceRoot: String(row.workspace_root) } }
  }
  private hash(name: string, root: string): string | null {
    const row = this.exact(name, root)
    return row ? (JSON.parse(String(row.snapshot_json)) as SkillSnapshot).contentHash : null
  }
}

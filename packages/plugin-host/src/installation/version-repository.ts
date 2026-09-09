import type { EdenDatabase } from '@eden/store'
import { pluginManifestSchema } from '@eden/plugin-sdk'
import type { BuiltPlugin } from '../builds/build-plugin.ts'
import { pluginRevision } from '../builds/build-plugin.ts'
import { testReportSchema } from '../testing/test-plugin.ts'
import type { PluginTestReport } from '../testing/test-plugin.ts'

export interface InstalledPlugin extends BuiltPlugin { report: PluginTestReport }
export class VersionRepository {
  constructor(private readonly database: EdenDatabase) {}

  install(plugin: BuiltPlugin, report: PluginTestReport): void {
    if (!report.passed || report.revision !== plugin.revision) throw new Error('Installation requires passing tests for this exact revision')
    this.database.connection.prepare('INSERT OR IGNORE INTO plugin_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      plugin.manifest.id, plugin.revision, plugin.manifest.version, JSON.stringify(plugin.manifest),
      plugin.source, plugin.artifact, JSON.stringify(report), Date.now(),
    )
  }

  read(id: string, revision: string): InstalledPlugin {
    const row = this.database.connection.prepare('SELECT * FROM plugin_versions WHERE plugin_id=? AND revision=?').get(id, revision)
    if (!row) throw new Error('Plugin version not installed')
    const plugin = { manifest: pluginManifestSchema.parse(JSON.parse(String(row.manifest_json))), source: String(row.source),
      artifact: String(row.artifact), revision: String(row.revision), report: testReportSchema.parse(JSON.parse(String(row.report_json))) }
    if (pluginRevision(plugin) !== plugin.revision || plugin.report.revision !== plugin.revision || !plugin.report.passed) throw new Error('Installed plugin integrity verification failed')
    return plugin
  }

  list(): { id: string; revision: string; version: string; active: boolean }[] {
    return this.database.connection.prepare(`SELECT v.plugin_id, v.revision, v.version,
      COALESCE(a.enabled=1 AND a.revision=v.revision, 0) AS active FROM plugin_versions v
      LEFT JOIN plugin_activations a ON a.plugin_id=v.plugin_id ORDER BY v.created_at DESC`)
      .all().map(row => ({ id: String(row.plugin_id), revision: String(row.revision), version: String(row.version), active: Boolean(row.active) }))
  }
}

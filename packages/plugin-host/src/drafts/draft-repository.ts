import { pluginManifestSchema, validateToolSchema, assertToolInput } from '@eden/plugin-sdk'
import type { PluginManifest } from '@eden/plugin-sdk'
import type { EdenDatabase } from '@eden/store'

export interface PluginDraft { manifest: PluginManifest; source: string }

export class DraftRepository {
  constructor(private readonly database: EdenDatabase) {}

  save(manifest: unknown, source: string): PluginDraft {
    const parsed = pluginManifestSchema.parse(manifest)
    validateToolSchema(parsed.tool.parameters)
    for (const sample of parsed.tests) assertToolInput(parsed.tool.parameters, sample.input)
    if (Buffer.byteLength(source) > 64 * 1024) throw new Error('Plugin source exceeds 64 KiB')
    this.database.connection.prepare(`INSERT INTO plugin_drafts VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET manifest_json=excluded.manifest_json, source=excluded.source, updated_at=excluded.updated_at`)
      .run(parsed.id, JSON.stringify(parsed), source, Date.now())
    return { manifest: parsed, source }
  }

  read(id: string): PluginDraft {
    const row = this.database.connection.prepare('SELECT * FROM plugin_drafts WHERE id=?').get(id)
    if (!row) throw new Error('Plugin draft not found')
    return { manifest: pluginManifestSchema.parse(JSON.parse(String(row.manifest_json))), source: String(row.source) }
  }
}

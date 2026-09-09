import { createHash } from 'node:crypto'
import { pluginManifestSchema, validateToolSchema, assertToolInput } from '@eden/plugin-sdk'
import type { PluginManifest } from '@eden/plugin-sdk'
import type { EdenDatabase } from '@eden/store'

export interface PluginDraft { manifest: PluginManifest; source: string; draftRevision?: string }

export class DraftRepository {
  constructor(private readonly database: EdenDatabase) {}

  save(manifest: unknown, source: string, expectedDraftRevision?: string | null): PluginDraft {
    const parsed = pluginManifestSchema.parse(manifest)
    if (this.database.connection.prepare('SELECT 1 FROM plugin_packages WHERE id=? LIMIT 1').get(parsed.id)) throw new Error('Plugin ID is already used by an installed component package')
    validateToolSchema(parsed.tool.parameters)
    for (const sample of parsed.tests) assertToolInput(parsed.tool.parameters, sample.input)
    if (Buffer.byteLength(source) > 64 * 1024) throw new Error('Plugin source exceeds 64 KiB')
    const draftRevision = this.revision(parsed, source)
    return this.database.transaction(() => {
      const db = this.database.connection
      const old = db.prepare('SELECT manifest_json,source FROM plugin_drafts WHERE id=?').get(parsed.id)
      if (old) {
        const previous = this.revision(pluginManifestSchema.parse(JSON.parse(String(old.manifest_json))), String(old.source))
        if (previous === draftRevision) return { manifest: parsed, source, draftRevision }
        if (previous !== expectedDraftRevision) throw new Error('Plugin draft changed; read its current draftRevision before replacing it')
      } else if (expectedDraftRevision != null) throw new Error('Plugin draft was removed; reload before saving')
      db.prepare(`INSERT INTO plugin_drafts VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET manifest_json=excluded.manifest_json,source=excluded.source,updated_at=excluded.updated_at`)
        .run(parsed.id, JSON.stringify(parsed), source, Date.now())
      return { manifest: parsed, source, draftRevision }
    })
  }
  private revision(manifest: PluginManifest, source: string) { return createHash('sha256').update(JSON.stringify({ manifest, source })).digest('hex') }

  read(id: string, expectedDraftRevision?: string): PluginDraft {
    const row = this.database.connection.prepare('SELECT * FROM plugin_drafts WHERE id=?').get(id)
    if (!row) throw new Error('Plugin draft not found')
    const manifest = pluginManifestSchema.parse(JSON.parse(String(row.manifest_json))), source = String(row.source)
    const draftRevision = this.revision(manifest, source)
    if (expectedDraftRevision !== undefined && expectedDraftRevision !== draftRevision) throw new Error('Plugin draft changed; reload before validating or testing')
    return { manifest, source, draftRevision }
  }
}

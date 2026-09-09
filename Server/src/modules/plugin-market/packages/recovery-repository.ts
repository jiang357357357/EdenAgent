import { recoveredPermissionHistory } from './recovery-permissions.ts'
import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { EdenDatabase } from '@eden/store'
const identity = z.tuple([z.string().min(1), z.string().min(1), z.string().regex(/^[a-f0-9]{64}$/)])
const inventory = z.object({ totalBytes: z.number().int().nonnegative(), files: z.record(z.string(), z.object({
  bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
})) })
export class PackageRecoveryRepository {
  constructor(private readonly database: EdenDatabase, private readonly dataRoot: string) {}
  permissions(sourceId: string, after?: string) { return recoveredPermissionHistory(this.database, sourceId, after) }
  list(after?: string) {
    const rows = this.database.connection.prepare(`SELECT h.source_id,h.state,c.relative_path,c.copied_at FROM legacy_plugin_history h
      LEFT JOIN legacy_plugin_file_copies c ON c.source_id=h.source_id WHERE h.domain='plugin_versions' AND h.source_id>? ORDER BY h.source_id LIMIT 51`).all(after ?? '')
    return { items: rows.slice(0, 50).map(row => {
      const [pluginId, version, revision] = identity.parse(JSON.parse(String(row.source_id)))
      return { sourceId: String(row.source_id), pluginId, version, revision, state: String(row.state),
        copied: row.relative_path !== null, copiedAt: row.copied_at === null ? null : Number(row.copied_at) }
    }), nextCursor: rows.length > 50 ? String(rows[49]!.source_id) : null }
  }
  async source(sourceId: string) {
    const [pluginId, version, revision] = identity.parse(JSON.parse(sourceId))
    const row = this.database.connection.prepare('SELECT relative_path,files_json FROM legacy_plugin_file_copies WHERE source_id=? AND plugin_id=? AND revision=?').get(sourceId, pluginId, revision)
    if (!row) throw new Error('Historical plugin files have not been recovered')
    const relative = String(row.relative_path)
    if (!/^recovered-plugins[/\\]copy-[a-zA-Z0-9]+[/\\]files$/.test(relative)) throw new Error('Invalid plugin recovery path')
    const root = await realpath(this.dataRoot)
    let current = root
    for (const part of relative.split(/[/\\]/)) {
      current = path.join(current, part)
      const info = await lstat(current)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Plugin recovery path contains a link or is missing')
    }
    const canonical = await realpath(current)
    if (!canonical.startsWith(root + path.sep)) throw new Error('Plugin recovery path escapes this world')
    return { pluginId, version, revision, path: canonical, inventory: inventory.parse(JSON.parse(String(row.files_json))) }
  }
  verifyFiles(expected: Awaited<ReturnType<PackageRecoveryRepository['source']>>, files: Map<string, Buffer>): void {
    if (files.size !== Object.keys(expected.inventory.files).length) throw new Error('Recovered plugin file set changed')
    let total = 0
    for (const [name, bytes] of files) {
      const prior = expected.inventory.files[name]
      if (!prior || bytes.length !== prior.bytes || createHash('sha256').update(bytes).digest('hex') !== prior.sha256) throw new Error('Recovered plugin bytes differ from the migration receipt')
      total += bytes.length
    }
    if (total !== expected.inventory.totalBytes) throw new Error('Recovered plugin byte count differs')
  }
}

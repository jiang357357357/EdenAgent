import { randomUUID } from 'node:crypto'
import { marketSourceSchema } from '@eden/api'
import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import type { LegacyRow } from './snapshot-format.ts'
import { legacyText, legacyJson, legacyTime, preserveLegacyRow } from './fields.ts'
import { tableConverted } from './conversion-state.ts'
type Result = { id: string; pluginId: string | null; state: string }
function plugin(db: DatabaseSync, row: LegacyRow): Result {
  const id = legacyText(row, 'id')
  legacyJson(row, 'manifest_json'); legacyTime(row.created_at); legacyTime(row.updated_at)
  if (row.enabled !== 0n && row.enabled !== 1n) throw new Error('Invalid historical plugin enablement flag')
  return { id, pluginId: id, state: 'files_required' }
}
function version(db: DatabaseSync, row: LegacyRow): Result {
  const id = legacyText(row, 'plugin_id'), version = legacyText(row, 'version'), revision = legacyText(row, 'revision')
  if (!db.prepare("SELECT 1 FROM legacy_plugin_history WHERE domain='plugins' AND source_id=?").get(id)) throw new Error('Historical plugin version has no owning plugin')
  legacyJson(row, 'manifest_json'); legacyTime(row.installed_at); legacyText(row, 'root_path')
  return { id: JSON.stringify([id, version, revision]), pluginId: id, state: 'files_required' }
}
function grant(db: DatabaseSync, row: LegacyRow): Result {
  const id = legacyText(row, 'plugin_id'), decision = legacyText(row, 'decision')
  if (!db.prepare("SELECT 1 FROM legacy_plugin_history WHERE domain='plugins' AND source_id=?").get(id)) throw new Error('Historical plugin permission has no owning plugin')
  if (!['allowed', 'denied'].includes(decision)) throw new Error('Invalid historical plugin permission decision')
  legacyTime(row.decided_at); legacyText(row, 'manifest_revision')
  return { id: JSON.stringify([id, legacyText(row, 'capability'), legacyText(row, 'resource'), legacyText(row, 'access')]), pluginId: id, state: 'reapproval_required' }
}
function source(db: DatabaseSync, row: LegacyRow): Result {
  const id = legacyText(row, 'id')
  if (row.enabled !== 0n && row.enabled !== 1n) throw new Error('Invalid historical market enablement flag')
  if (row.index_json !== null) legacyJson(row, 'index_json')
  legacyTime(row.created_at); legacyTime(row.updated_at)
  const parsed = marketSourceSchema.safeParse({ id, name: legacyText(row, 'name'), url: legacyText(row, 'url'), keyID: legacyText(row, 'key_id'), enabled: false })
  if (!parsed.success) return { id, pluginId: null, state: 'source_review_required' }
  const input = parsed.data
  db.prepare(`INSERT INTO plugin_market_sources(id,name,url,key_id,enabled,epoch,last_error) VALUES(?,?,?,?,0,?,?)`)
    .run(id, input.name, input.url, input.keyID, randomUUID(), 'Historical signing key and index require verification before enabling')
  return { id, pluginId: null, state: 'key_required' }
}
function revocation(db: DatabaseSync, row: LegacyRow): Result {
  const sourceId = legacyText(row, 'source_id'), id = legacyText(row, 'plugin_id'), version = legacyText(row, 'version'), revision = legacyText(row, 'revision')
  if (!db.prepare("SELECT 1 FROM legacy_plugin_history WHERE domain='plugin_market_sources' AND source_id=?").get(sourceId)) throw new Error('Historical revocation source is missing')
  db.prepare('INSERT INTO legacy_plugin_revocations VALUES(?,?,?,?,?,?)').run(sourceId, id, version, revision, legacyText(row, 'reason'), legacyTime(row.revoked_at))
  return { id: JSON.stringify([sourceId, id, version, revision]), pluginId: id, state: 'denial_preserved' }
}
const domains = [['plugins', plugin], ['plugin_versions', version], ['plugin_permission_grants', grant],
  ['plugin_market_sources', source], ['plugin_market_revocations', revocation]] as const
/** Metadata does not stand in for verified plugin files, signature keys, or fresh grants. */
export async function convertLegacyPlugins(db: DatabaseSync, snapshot: LegacySnapshotReader): Promise<void> {
  for (const [name, convert] of domains) {
    if (!snapshot.manifest.tables.some(table => table.name === name) || tableConverted(db, name)) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      await snapshot.scan(name, row => {
        const value = convert(db, row), preserved = preserveLegacyRow(row)
        db.prepare('INSERT INTO legacy_plugin_history(domain,source_id,plugin_id,state,row_json) VALUES(?,?,?,?,?)').run(name, value.id, value.pluginId, value.state, preserved)
        db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run(name, value.id, preserved)
        db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run(name, value.id, value.id)
      })
      db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name=?").run(name)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
}

import type { EdenDatabase } from '@eden/store'
import type { PackagePermissionDecision } from '@eden/api'
function field(raw: string, key: string): string {
  const row: unknown = JSON.parse(raw)
  if (!row || typeof row !== 'object' || !(key in row)) throw new Error('Historical permission record is incomplete')
  const cell = (row as Record<string, unknown>)[key]
  if (!cell || typeof cell !== 'object' || !('type' in cell) || cell.type !== 'text' || !('value' in cell) || typeof cell.value !== 'string') throw new Error('Historical permission field has invalid encoding')
  return cell.value
}
/** Called inside the current grant transaction; only explicit decisions for the same revision settle history. */
export function recordRecoveredPermissionDecisions(database: EdenDatabase, id: string, revision: string, decisions: PackagePermissionDecision[], now: number): void {
  if (!database.inTransaction) throw new Error('Historical permission settlement requires the grant transaction')
  const db = database.connection
  for (const decision of decisions) {
    const sourceId = JSON.stringify([id, decision.capability, decision.resource, decision.access])
    const row = db.prepare("SELECT row_json FROM legacy_plugin_history WHERE domain='plugin_permission_grants' AND source_id=? AND plugin_id=?").get(sourceId, id)
    if (!row || field(String(row.row_json), 'manifest_revision') !== revision) continue
    db.prepare("UPDATE legacy_plugin_history SET state='permission_reviewed',resolution_json=?,resolved_at=? WHERE domain='plugin_permission_grants' AND source_id=?")
      .run(JSON.stringify({ revision, ...decision }), now, sourceId)
  }
}
export function recoveredPermissionHistory(database: EdenDatabase, sourceId: string, after?: string) {
  const version = database.connection.prepare("SELECT plugin_id,row_json FROM legacy_plugin_history WHERE domain='plugin_versions' AND source_id=?").get(sourceId)
  if (!version) throw new Error('Historical plugin version was not found')
  const revision = field(String(version.row_json), 'revision')
  const rows = database.connection.prepare(`SELECT source_id,row_json,state,resolution_json,resolved_at FROM legacy_plugin_history
    WHERE domain='plugin_permission_grants' AND plugin_id=? AND source_id>? ORDER BY source_id LIMIT 51`).all(version.plugin_id!, after ?? '')
  return { items: rows.slice(0, 50).map(row => {
    const raw = String(row.row_json), originalRevision = field(raw, 'manifest_revision')
    return { sourceId: String(row.source_id), capability: field(raw, 'capability'), resource: field(raw, 'resource'), access: field(raw, 'access'),
      originalDecision: field(raw, 'decision'), originalRevision, matchesVersion: originalRevision === revision, state: String(row.state),
      currentDecision: row.resolution_json === null ? null : String(JSON.parse(String(row.resolution_json)).decision),
      reviewedAt: row.resolved_at === null ? null : Number(row.resolved_at) }
  }), nextCursor: rows.length > 50 ? String(rows[49]!.source_id) : null }
}

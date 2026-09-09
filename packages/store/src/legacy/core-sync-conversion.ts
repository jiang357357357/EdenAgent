import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import type { LegacyRow } from './snapshot-format.ts'
import { tableConverted } from './conversion-state.ts'
import { legacyText, legacyUuid, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'

function identity(db: DatabaseSync, row: LegacyRow): string {
  const session = legacyUuid(row, 'session_id'), base = legacyText(row, 'core_base_url')
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid legacy Core base URL')
  db.prepare(`INSERT INTO legacy_core_identities(session_id,core_base_url,principal_key,credential_ref,state,updated_at)
    VALUES(?,?,?,?,'rebind_required',?)`).run(session, base, legacyText(row, 'principal_key'), legacyText(row, 'credential_ref'), legacyTime(row.updated_at))
  return session
}
function outbox(db: DatabaseSync, row: LegacyRow): string {
  if (typeof row.id !== 'bigint' || row.id < 1n || row.id > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid legacy Core outbox ID')
  const status = legacyText(row, 'state'), attempts = legacyTime(row.attempts)
  if (!['queued', 'claimed', 'completed'].includes(status) || attempts < 0) throw new Error('Invalid legacy Core delivery state')
  db.prepare(`INSERT INTO legacy_core_outbox(id,session_id,credential_ref,kind,dedupe_key,payload_json,state,attempts,
    next_attempt_at,claimed_at,last_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.id,
      legacyUuid(row, 'session_id'), legacyText(row, 'credential_ref'), legacyText(row, 'kind'), legacyText(row, 'dedupe_key'), legacyJson(row, 'payload_json'),
      status === 'claimed' ? 'unknown' : status === 'queued' ? 'held' : status, attempts, legacyTime(row.next_attempt_at),
      row.claimed_at === null ? null : legacyTime(row.claimed_at), row.last_error === null ? null : legacyText(row, 'last_error'),
      legacyTime(row.created_at), legacyTime(row.updated_at))
  return String(row.id)
}
export async function convertLegacyCoreSync(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  const converted: string[] = []
  for (const [name, convert] of [['core_session_identities', identity], ['core_sync_outbox', outbox]] as const) {
    if (!source.manifest.tables.some(table => table.name === name)) continue
    if (tableConverted(db, name)) { converted.push(name); continue }
    db.exec('BEGIN IMMEDIATE')
    try {
      await source.scan(name, row => {
        const id = convert(db, row)
        db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run(name, id, id)
        db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run(name, id, preserveLegacyRow(row))
      })
      db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name=?").run(name)
      db.exec('COMMIT'); converted.push(name)
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  return converted
}

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import type { LegacyRow } from './snapshot-format.ts'
import { tableConverted } from './conversion-state.ts'
import { legacyText, legacyUuid, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'

function identity(db: DatabaseSync, row: LegacyRow) {
  const desired = legacyText(row, 'desired_state'), settings = legacyJson(row, 'settings_json')
  const value: unknown = JSON.parse(settings)
  if (!['connected', 'disconnected'].includes(desired) || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid legacy connector settings')
  db.prepare(`INSERT INTO connectors(id,connector_key,identity_key,display_name,desired_state,runtime_state,settings_json,last_error,created_at,updated_at,generation)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(legacyUuid(row, 'id'), legacyText(row, 'connector_key'), legacyText(row, 'identity_key'),
      legacyText(row, 'display_name'), desired, desired === 'connected' ? 'error' : 'disconnected', settings,
      desired === 'connected' ? 'Imported connector requires current worker permissions and credentials' : row.last_error === null ? null : legacyText(row, 'last_error'),
      legacyTime(row.created_at), legacyTime(row.updated_at), randomUUID())
}
function event(db: DatabaseSync, row: LegacyRow) {
  const state = legacyText(row, 'status'), connectorId = legacyUuid(row, 'connector_id')
  if (!['pending', 'claimed', 'completed', 'failed'].includes(state)) throw new Error('Invalid legacy connector event state')
  const connector = db.prepare('SELECT settings_json FROM connectors WHERE id=?').get(connectorId)
  if (!connector) throw new Error('Legacy connector event identity is absent')
  // Old tables have no authoritative session/job link. Do not infer ownership from today's binding.
  db.prepare(`INSERT INTO connector_events(id,connector_id,external_id,event_type,payload_json,session_id,job_id,suppression,created_at)
    VALUES(?,?,?,?,?,NULL,NULL,?,?)`).run(legacyUuid(row, 'id'), connectorId, legacyText(row, 'external_id'), legacyText(row, 'event_type'),
      legacyJson(row, 'payload_json'), `legacy_${state === 'claimed' ? 'unknown' : state}`, legacyTime(row.created_at))
}
export async function convertLegacyConnectors(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  const converted: string[] = []
  for (const [name, convert] of [['connectors', identity], ['connector_events', event]] as const) {
    if (!source.manifest.tables.some(table => table.name === name)) continue
    if (tableConverted(db, name)) { converted.push(name); continue }
    db.exec('BEGIN IMMEDIATE')
    try {
      await source.scan(name, row => {
        convert(db, row)
        const id = legacyUuid(row, 'id')
        db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run(name, id, id)
        db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run(name, id, preserveLegacyRow(row))
      })
      db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name=?").run(name)
      db.exec('COMMIT'); converted.push(name)
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  return converted
}

import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import type { LegacyRow } from './snapshot-format.ts'
import { legacyText, legacyTime, legacyUuid, preserveLegacyRow } from './fields.ts'
import { tableConverted } from './conversion-state.ts'

function total(db: DatabaseSync, row: LegacyRow): string {
  const metric = legacyText(row, 'metric')
  if (!metric || metric.length > 256 || metric.includes('\0')) throw new Error('Invalid historical metric name')
  if (typeof row.value !== 'bigint' || row.value < 0n) throw new Error('Invalid historical metric total')
  db.prepare('INSERT INTO legacy_metric_totals VALUES(?,?)').run(metric, String(row.value))
  return metric
}
function turn(db: DatabaseSync, row: LegacyRow): string {
  const session = legacyUuid(row, 'session_id'), id = legacyUuid(row, 'turn_id')
  db.prepare('INSERT INTO legacy_metric_turns VALUES(?,?,?,?)').run(session, id, legacyTime(row.started_at),
    row.first_response_at === null ? null : legacyTime(row.first_response_at))
  return JSON.stringify([session, id])
}
function tool(db: DatabaseSync, row: LegacyRow): string {
  const session = legacyUuid(row, 'session_id'), id = legacyUuid(row, 'turn_id'), call = legacyText(row, 'tool_call_id')
  if (!call || call.length > 4096 || call.includes('\0')) throw new Error('Invalid historical metric tool call ID')
  db.prepare('INSERT INTO legacy_metric_tool_calls VALUES(?,?,?,?)').run(session, id, call, legacyTime(row.started_at))
  return JSON.stringify([session, id, call])
}
const converters = [ ['runtime_metric_totals', total], ['runtime_metric_turns', turn], ['runtime_metric_tool_calls', tool] ] as const

/** Old in-flight timing rows are evidence, not new completion samples or work to restart. */
export async function convertLegacyMetrics(db: DatabaseSync, source: LegacySnapshotReader): Promise<void> {
  for (const [name, convert] of converters) {
    if (!source.manifest.tables.some(table => table.name === name) || tableConverted(db, name)) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      await source.scan(name, row => {
        const id = convert(db, row)
        db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run(name, id, preserveLegacyRow(row))
        db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run(name, id, id)
      })
      db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name=?").run(name)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  }
}

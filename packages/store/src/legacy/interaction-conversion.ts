import { tableConverted } from './conversion-state.ts'
import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import type { LegacyRow } from './snapshot-format.ts'
import { legacyText, legacyUuid, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'

function convertPermission(db: DatabaseSync, row: LegacyRow) {
  const state = legacyText(row, 'state')
  if (!['pending', 'allowed', 'denied', 'expired'].includes(state)) throw new Error('Unsupported legacy permission state')
  db.prepare(`INSERT INTO permission_requests(id,session_id,turn_id,operation_id,capability,resource,state,request_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(legacyUuid(row, 'id'), legacyUuid(row, 'session_id'), legacyUuid(row, 'turn_id'),
      legacyText(row, 'operation_id'), legacyText(row, 'capability'), legacyText(row, 'resource'), state === 'pending' ? 'interrupted' : state,
      legacyJson(row, 'request_json'), legacyTime(row.created_at))
}
function convertQuestion(db: DatabaseSync, row: LegacyRow) {
  const state = legacyText(row, 'state'), questions = legacyJson(row, 'questions_json')
  if (!['pending', 'answered', 'rejected', 'expired'].includes(state) || !Array.isArray(JSON.parse(questions))) throw new Error('Invalid legacy question')
  const answers = row.answers_json == null ? null : legacyJson(row, 'answers_json')
  db.prepare(`INSERT INTO question_requests(id,session_id,turn_id,state,questions_json,answers_json,created_at,resolved_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(legacyUuid(row, 'id'), legacyUuid(row, 'session_id'), legacyUuid(row, 'turn_id'), state === 'pending' ? 'interrupted' : state,
      questions, answers, legacyTime(row.created_at), row.resolved_at == null ? null : legacyTime(row.resolved_at))
}
export async function convertLegacyInteractions(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  const converted: string[] = []
  for (const [name, convert] of [['permission_requests', convertPermission], ['question_requests', convertQuestion]] as const) {
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

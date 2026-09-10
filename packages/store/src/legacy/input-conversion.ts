import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import { tableConverted } from './conversion-state.ts'
import { legacyText, legacyUuid, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'

export async function convertLegacyInputs(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  const name = 'session_inputs'
  if (!source.manifest.tables.some(table => table.name === name)) return []
  if (tableConverted(db, name)) return [name]
  db.exec('BEGIN IMMEDIATE')
  try {
    await source.scan(name, row => {
      const id = legacyUuid(row, 'id'), session = legacyUuid(row, 'session_id'), turn = legacyUuid(row, 'turn_id')
      const originalState = legacyText(row, 'state'), payload = legacyJson(row, 'payload_json')
      const value: unknown = JSON.parse(payload)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid legacy input payload')
      const input = value as Record<string, unknown>
      if (!['queued', 'claimed', 'completed', 'interrupted'].includes(originalState)) throw new Error('Invalid legacy input state')
      const state = originalState === 'queued' ? 'held' : originalState === 'claimed' ? 'interrupted' : originalState
      const text = typeof input.text === 'string' ? input.text : ''
      const created = legacyTime(row.created_at)
      const updated = row.completed_at !== null ? legacyTime(row.completed_at) : row.claimed_at !== null ? legacyTime(row.claimed_at) : created
      db.prepare(`INSERT INTO inputs(id,session_id,turn_id,idempotency_key,text,state,created_at,metadata_json,kind)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(id, session, turn, `legacy-input:${id}`, text, state, created,
        JSON.stringify({ legacyInput: input, legacyState: originalState }), input.compact === true ? 'compact' : 'prompt')
      db.prepare('INSERT INTO turns(id,session_id,state,error,created_at,updated_at) VALUES(?,?,?,?,?,?)')
        .run(turn, session, state, state === 'completed' ? null : 'Legacy input requires runtime-context recovery before resubmission', created, updated)
      db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run(name, id, id)
      db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run('turns', turn, turn)
      db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run(name, id, preserveLegacyRow(row))
      linkInputJob(input, db, session, id, state)
    })
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name=?").run(name)
    db.exec('COMMIT')
    return [name]
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

function linkInputJob(input: Record<string, unknown>, db: DatabaseSync, session: string, id: string, state: string) {
  if (typeof input.jobId === 'string') {
    const job = db.prepare('SELECT session_id,input_id FROM jobs WHERE id=?').get(input.jobId)
    if (!job || job.session_id !== session || job.input_id !== null) throw new Error('Legacy input job linkage is missing or ambiguous')
    db.prepare("UPDATE jobs SET input_id=?,state=?,error=? WHERE id=?").run(id,
      state === 'completed' ? 'completed' : 'unknown', state === 'completed' ? null : 'Legacy input retained; automatic job redispatch disabled', input.jobId)
  }
}

import { tableConverted } from './conversion-state.ts'
import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import type { LegacyRow } from './snapshot-format.ts'
import { legacyText, legacyUuid, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'

const optionalTime = (row: LegacyRow, key: string) => row[key] === null ? null : legacyTime(row[key])

function run(db: DatabaseSync, row: LegacyRow): void {
  const id = legacyUuid(row, 'id'), jobId = legacyUuid(row, 'job_id'), sessionId = legacyUuid(row, 'session_id')
  const status = legacyText(row, 'status')
  if (!['pending', 'running', 'completed', 'failed'].includes(status)) throw new Error('Invalid legacy self-awake run status')
  if (legacyText(row, 'schema_version') !== 'self-awake.v1') throw new Error('Unsupported legacy self-awake schema')
  const { interrupted, state, resumePreparing } = legacyRunState(db, jobId, sessionId, status)
  const attempts = legacyTime(row.attempts)
  if (attempts < 0) throw new Error('Invalid legacy self-awake attempt count')
  const error = interrupted ? 'Legacy run did not finish; automatic replay is disabled' : row.last_error === null ? null : legacyText(row, 'last_error')
  db.prepare(`INSERT INTO self_awake_runs(id,job_id,session_id,event_id,state,request_json,author_json,decision_json,
    attempts,last_error,started_at,completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, jobId, sessionId, legacyText(row, 'event_id'), state, legacyJson(row, 'request_json'),
      legacyJson(row, 'author_snapshot_json'), row.decision_json === null ? null : legacyJson(row, 'decision_json'),
      attempts, error, optionalTime(row, 'started_at'), optionalTime(row, 'completed_at'), legacyTime(row.created_at), legacyTime(row.updated_at))
  // A persisted run is stronger evidence than an old scheduled flag; never replay a finished/running run.
  if (!resumePreparing) db.prepare("UPDATE jobs SET state=?,error=? WHERE id=? AND state='queued'")
    .run(interrupted ? 'unknown' : status, error, jobId)
}

function legacyRunState(db: DatabaseSync, jobId: string, sessionId: string, status: string) {
  const job = db.prepare('SELECT state,session_id,kind FROM jobs WHERE id=?').get(jobId)
  if (!job || job.session_id !== sessionId || job.kind !== 'self_awake') throw new Error('Legacy self-awake run job ownership mismatch')
  const resumePreparing = status === 'pending' && job.state === 'queued'
  const interrupted = status === 'running' || (status === 'pending' && !resumePreparing)
  const state = interrupted ? 'interrupted' : resumePreparing ? 'preparing' : status
  return { interrupted, state, resumePreparing }
}

function diary(db: DatabaseSync, row: LegacyRow): void {
  const id = legacyUuid(row, 'id'), runId = legacyUuid(row, 'run_id'), sessionId = legacyUuid(row, 'session_id')
  const owner = db.prepare('SELECT session_id FROM self_awake_runs WHERE id=?').get(runId)
  if (!owner || owner.session_id !== sessionId) throw new Error('Legacy diary does not belong to its run session')
  db.prepare(`INSERT INTO self_awake_diaries(id,run_id,session_id,assistant_id,character_id,title,content,mood,metadata_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, runId, sessionId, legacyText(row, 'assistant_id'), legacyText(row, 'character_id'),
    legacyText(row, 'title'), legacyText(row, 'content'), legacyText(row, 'mood'), legacyJson(row, 'metadata_json'), legacyTime(row.created_at))
}

export async function convertSelfAwakeHistory(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  const converted: string[] = []
  for (const [name, convert] of [['self_awake_runs', run], ['self_awake_diaries', diary]] as const) {
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

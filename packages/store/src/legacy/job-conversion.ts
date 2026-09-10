import { tableConverted } from './conversion-state.ts'
import { convertSelfAwakeJob } from './self-awake-job.ts'
import { convertSelfAwakeSubmission } from './self-awake-submission.ts'
import type { DatabaseSync } from 'node:sqlite'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import type { LegacyRow } from './snapshot-format.ts'
import { legacyText, legacyUuid, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'

type ConvertedJob = { state: string; key: string; payload: string; dueAt: number; sessionId: string | null; causation: string; error: string | null }

function reminder(db: DatabaseSync, job: ConvertedJob): ConvertedJob {
  const memo = reminderMemo(job, db)
  const occurrence = memo.snoozed_until ?? memo.remind_at ?? memo.due_at
  const revision = Number(memo.updated_at), memoId = Number(memo.id)
  if (occurrence === null || occurrence === undefined) return job.state === 'unknown' ? job : { ...job, state: 'cancelled', error: 'Imported reminder has no scheduled occurrence' }
  const dueAt = Number(occurrence)
  const active = memo.status === 'active' && (memo.last_triggered_at === null || Number(memo.last_triggered_at) < dueAt)
  // An uncertain old dispatch reserves only its own occurrence, never a subsequently edited reminder.
  if (job.state === 'unknown' && dueAt !== job.dueAt) return job
  if (!active) return job.state === 'unknown' ? job : { ...job, state: 'cancelled', error: 'Imported reminder is no longer pending' }
  return {
    ...job, dueAt, key: `memo:${memoId}:${revision}`, causation: `memo:${memoId}`,
    sessionId: String(memo.related_session_id) || null, payload: JSON.stringify({ memoId, revision, occurrence: dueAt })
  }
}

function reminderMemo(job: ConvertedJob, db: DatabaseSync) {
  const payload: unknown = JSON.parse(job.payload)
  if (!payload || typeof payload !== 'object' || !('memoId' in payload) ||
    typeof payload.memoId !== 'number' || !Number.isSafeInteger(payload.memoId) || Number(payload.memoId) < 1) throw new Error('Invalid legacy reminder payload')
  const memo = db.prepare('SELECT * FROM memos WHERE id=?').get(Number(payload.memoId))
  if (!memo) throw new Error('Legacy reminder has no converted memo')
  return memo
}

function convertJob(db: DatabaseSync, row: LegacyRow): void {
  const id = legacyUuid(row, 'id'), kind = legacyText(row, 'kind'), state = legacyText(row, 'state')
  if (!['scheduled', 'claimed', 'completed', 'failed', 'cancelled'].includes(state)) throw new Error('Unsupported legacy job state')
  const attempts = legacyTime(row.attempts)
  if (attempts < 0) throw new Error('Invalid legacy job attempts')
  let job: ConvertedJob = {
    state: state === 'claimed' ? 'unknown' : state === 'scheduled' ? 'queued' : state,
    key: `legacy-job:${id}`, payload: legacyJson(row, 'payload_json'), dueAt: legacyTime(row.due_at),
    sessionId: row.session_id === null ? null : legacyUuid(row, 'session_id'), causation: `legacy-job:${id}`,
    error: state === 'claimed' ? 'Legacy dispatch outcome is unknown; automatic replay is disabled' : row.last_error === null ? null : legacyText(row, 'last_error')
  }
  if (kind === 'self_awake') {
    const converted = convertSelfAwakeJob(db, row)
    job = state === 'scheduled' ? { ...job, ...converted } : {
      ...job,
      sessionId: converted.sessionId, payload: converted.payload, causation: converted.causation
    }
  }
  if (state === 'scheduled' && !['memo.reminder', 'self_awake'].includes(kind)) throw new Error(`Scheduled legacy job requires a domain converter: ${kind}`)
  if (kind === 'memo.reminder' && ['scheduled', 'claimed'].includes(state)) job = reminder(db, job)
  db.prepare(`INSERT INTO jobs(id,kind,session_id,due_at,payload_json,operation_key,causation_id,depth,state,attempts,error,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?)`).run(id, kind, job.sessionId, job.dueAt, job.payload, job.key, job.causation,
    job.state, attempts, job.error, legacyTime(row.created_at), legacyTime(row.updated_at))
  db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run('jobs', id, id)
  if (kind === 'self_awake') convertSelfAwakeSubmission(db, row)
  db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run('jobs', id, preserveLegacyRow(row))
}

export async function convertLegacyJobs(db: DatabaseSync, source: LegacySnapshotReader): Promise<string[]> {
  if (!source.manifest.tables.some(table => table.name === 'jobs')) return []
  if (tableConverted(db, 'jobs')) return ['jobs']
  db.exec('BEGIN IMMEDIATE')
  try {
    await source.scan('jobs', row => convertJob(db, row))
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name='jobs'").run()
    db.exec('COMMIT')
    return ['jobs']
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

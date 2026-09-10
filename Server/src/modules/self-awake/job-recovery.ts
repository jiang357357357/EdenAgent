import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { jsonValue } from '@eden/api'
import type { JobInfo, JsonValue } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { JobRepository } from '../jobs/index.ts'
import type { SessionService } from '../sessions/index.ts'

const payloadSchema = z.object({
  prompt: z.string().optional(), trigger: jsonValue.optional(),
  schemaVersion: z.literal('self-awake.v1').optional(), scheduler: z.literal('monos').optional(),
  eventId: z.string().optional(), userId: z.string().optional(),
}).strict()

export class SelfAwakeJobRecovery {
  constructor(private readonly database: EdenDatabase, private readonly jobs: JobRepository, private readonly sessions: SessionService) { }

  private basis(id: string) {
    const job = this.jobs.read(id), db = this.database.connection
    if (job.kind !== 'self_awake' || !job.sessionId || !['failed', 'cancelled', 'completed'].includes(job.state)) throw new Error('Stop or reconcile the original self-awake job first')
    const payload = payloadSchema.parse(job.payload)
    const run = assertPriorDecision(db, id, job)
    this.sessions.repository.assertContextReady(job.sessionId)
    const session = this.sessions.repository.read(job.sessionId)
    if (session.status !== 'active' || session.participants.length > 1) throw new Error('Restore an active single-character self-awake session first')
    const author = session.participants[0] ?? {}, environment = session.environment
    if (run && !isDeepStrictEqual(JSON.parse(String(run.author_json)), author)) throw new Error('Original self-awake author differs from the current session')
    const owner = recoveryOwner(db, id, environment, payload)
    return { job, run: run ?? null, author, environment, owner: owner ? String(owner.user_id) : null }

  }

  preview(id: string) {
    const basis = this.basis(id)
    return {
      fingerprint: createHash('sha256').update(JSON.stringify(basis)).digest('hex'), job: basis.job,
      runId: basis.run ? String(basis.run.id) : null, author: basis.author, environment: basis.environment
    }
  }

  resubmit(id: string, fingerprint: string, note: string): JobInfo {
    return this.database.transaction(() => {
      const db = this.database.connection
      const previous = db.prepare('SELECT * FROM self_awake_job_resubmissions WHERE source_job_id=?').get(id)
      if (previous) {
        if (previous.fingerprint !== fingerprint || previous.note !== note) throw new Error('Self-awake job was already resubmitted with different evidence')
        return this.jobs.read(String(previous.new_job_id))
      }
      const preview = this.preview(id), basis = this.basis(id)
      if (preview.fingerprint !== fingerprint) throw new Error('Self-awake recovery evidence changed; preview again')
      const next = this.jobs.scheduleInTransaction({
        kind: 'self_awake', sessionId: basis.job.sessionId, dueAt: Date.now(),
        payload: basis.job.payload, key: `self-awake-resubmit:${id}`, causationId: basis.job.causationId, depth: basis.job.depth
      })
      db.prepare('INSERT INTO self_awake_job_resubmissions VALUES(?,?,?,?,?,?,?)')
        .run(id, next.id, fingerprint, JSON.stringify(basis.author), JSON.stringify(basis.environment), note, Date.now())
      if (basis.owner) db.prepare('INSERT INTO self_awake_submissions(user_id,request_key,request_hash,job_id) VALUES(?,?,?,?)')
        .run(basis.owner, `recovery:${next.id}`, fingerprint, next.id)
      return next
    })
  }

  assertDispatch(job: JobInfo, author: JsonValue, environment: JsonValue) {
    const row = this.database.connection.prepare('SELECT source_job_id,author_json,environment_json FROM self_awake_job_resubmissions WHERE new_job_id=?').get(job.id)
    if (row && (!isDeepStrictEqual(JSON.parse(String(row.author_json)), author) || !isDeepStrictEqual(JSON.parse(String(row.environment_json)), environment))) {
      throw new Error('Self-awake author or environment changed after resubmission confirmation')
    }
    return row ? { source_job_id: String(row.source_job_id), instruction: 'This is an explicitly requested new decision after failure. Previous tool effects, diaries and notifications remain real. Inspect prior records before repeating an action; this recovery is not authorization for tools.' } : null
  }
}

function recoveryOwner(db: import('node:sqlite').DatabaseSync, id: string, environment: JsonValue, payload: z.output<typeof payloadSchema>) {

  const owner = db.prepare('SELECT user_id FROM self_awake_submissions WHERE job_id=?').get(id)
  const env = environment as Record<string, JsonValue>
  if (owner && env.selfAwakeUserId !== owner.user_id) throw new Error('Self-awake submission owner differs from the current environment')
  if (payload.scheduler === 'monos' && (!owner || owner.user_id !== payload.userId || env.selfAwakeUserId !== payload.userId)) throw new Error('Restore the original external self-awake owner first')
  return owner

}

function assertPriorDecision(db: import('node:sqlite').DatabaseSync, id: string, job: JobInfo) {

  const run = db.prepare('SELECT * FROM self_awake_runs WHERE job_id=?').get(id)
  if (run && (!['failed', 'preparing'].includes(String(run.state)) || run.decision_json !== null || run.action_result_json !== null)) throw new Error('An existing self-awake decision must use action recovery, not a new decision')
  if (job.state === 'completed' && run?.state !== 'failed') throw new Error('A completed self-awake job can only be resubmitted after decision failure')
  if (run && (run.session_id !== job.sessionId || run.input_id !== job.inputId)) throw new Error('Self-awake run and job ownership differ')
  if (job.inputId) {
    const input = db.prepare('SELECT state,turn_id,session_id FROM inputs WHERE id=?').get(job.inputId)
    if (!input || input.session_id !== job.sessionId || !['completed', 'failed', 'cancelled'].includes(String(input.state))) throw new Error('Resolve the original self-awake input first')
    if (db.prepare("SELECT 1 FROM tool_operations WHERE turn_id=? AND state IN ('running','unknown') LIMIT 1").get(input.turn_id!)) throw new Error('Reconcile unknown self-awake tool effects first')
  }
  return run

}

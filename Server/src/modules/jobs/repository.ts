import { randomUUID } from 'node:crypto'
import { resolveJobOutcome } from './outcome-review.ts'
import { jobScheduleSchema, jobInfoSchema, jobListSchema, jobIdSchema, jobPageSchema } from '@eden/api'
import type { JobSchedule, JobInfo } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { SQLOutputValue } from 'node:sqlite'

/** Jobs dispatch durable inputs/notifications only. External effects belong to turn operation ledgers. */
export class JobRepository {
  constructor(private readonly database: EdenDatabase) {}

  schedule(value: JobSchedule): JobInfo { return this.database.transaction(() => this.scheduleInTransaction(value)) }
  byKey(key: string): JobInfo | undefined {
    const row = this.database.connection.prepare('SELECT id FROM jobs WHERE operation_key=?').get(key)
    return row ? this.read(String(row.id)) : undefined
  }
  resolveOutcome(id: string, expectedUpdatedAt: number, decision: 'completed' | 'cancelled', note: string): JobInfo {
    resolveJobOutcome(this.database, id, expectedUpdatedAt, decision, note)
    return this.read(id)
  }

  scheduleInTransaction(value: JobSchedule): JobInfo {
    this.owningTransaction()
    const input = jobScheduleSchema.parse(value)
    const existing = this.database.connection.prepare('SELECT * FROM jobs WHERE operation_key=?').get(input.key)
    if (existing) {
      const job = fromRow(existing)
      if (job.kind !== input.kind || job.sessionId !== input.sessionId || JSON.stringify(job.payload) !== JSON.stringify(input.payload)) throw new Error('Job key belongs to a different operation')
      return job
    }
    const id = randomUUID(), now = Date.now()
    this.database.connection.prepare(`INSERT INTO jobs(id,kind,session_id,due_at,payload_json,operation_key,causation_id,depth,state,attempts,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'queued',0,?,?)`).run(id, input.kind, input.sessionId, input.dueAt, JSON.stringify(input.payload), input.key, input.causationId, input.depth, now, now)
    return this.read(id)
  }

  read(id: string): JobInfo {
    jobIdSchema.parse({ id })
    const row = this.database.connection.prepare('SELECT * FROM jobs WHERE id=?').get(id)
    if (!row) throw new Error('Job not found in this world')
    return fromRow(row)
  }

  list(value: unknown = {}): JobInfo[] {
    const input = jobListSchema.parse(value)
    return this.database.connection.prepare(`SELECT * FROM jobs WHERE (? IS NULL OR session_id=?) AND (? IS NULL OR state=?) ORDER BY created_at DESC,id DESC LIMIT ?`)
      .all(input.sessionId ?? null, input.sessionId ?? null, input.state ?? null, input.state ?? null, input.limit).map(fromRow)
  }
  page(value: unknown = {}) {
    const input = jobPageSchema.parse(value), states = input.states ? JSON.stringify(input.states) : null
    const beforeTime = input.before?.createdAt ?? null, beforeId = input.before?.id ?? null
    const rows = this.database.connection.prepare(`SELECT * FROM jobs WHERE (? IS NULL OR session_id=?)
      AND (? IS NULL OR kind=?) AND (? IS NULL OR state IN (SELECT value FROM json_each(?)))
      AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?`)
      .all(input.sessionId ?? null, input.sessionId ?? null, input.kind ?? null, input.kind ?? null, states, states,
        beforeTime, beforeTime, beforeTime, beforeId, input.limit + 1)
    const items = rows.slice(0, input.limit).map(fromRow), last = items.at(-1)
    return { items, nextCursor: rows.length > input.limit && last ? { createdAt: last.createdAt, id: last.id } : null }
  }

  recover(): void {
    this.database.transaction(() => {
      this.database.connection.prepare("UPDATE jobs SET state='queued',error='Interrupted before durable dispatch',updated_at=? WHERE state='running'").run(Date.now())
    })
  }

  claim(now = Date.now()): JobInfo | undefined {
    return this.database.transaction(() => {
      const row = this.database.connection.prepare("SELECT id FROM jobs WHERE state='queued' AND due_at<=? ORDER BY due_at,id LIMIT 1").get(now)
      if (!row) return undefined
      this.database.connection.prepare("UPDATE jobs SET state='running',attempts=attempts+1,updated_at=? WHERE id=?").run(now, row.id!)
      return this.read(String(row.id))
    })
  }

  completeInTransaction(id: string, inputId: string | null = null): void {
    this.owningTransaction()
    const result = this.database.connection.prepare("UPDATE jobs SET state=?,input_id=?,error=NULL,updated_at=? WHERE id=? AND state='running'")
      .run(inputId ? 'dispatched' : 'completed', inputId, Date.now(), id)
    if (result.changes !== 1) throw new Error('Job is no longer owned by this dispatcher')
  }

  defer(id: string, error: string, delayMs = 30000): void {
    this.database.connection.prepare("UPDATE jobs SET state='queued',due_at=?,error=?,updated_at=? WHERE id=? AND state='running'")
      .run(Date.now() + delayMs, error.slice(0, 4000), Date.now(), id)
  }

  fail(id: string, error: string): void {
    this.database.connection.prepare("UPDATE jobs SET state='failed',error=?,updated_at=? WHERE id=? AND state='running'").run(error.slice(0, 4000), Date.now(), id)
  }

  cancel(id: string): JobInfo {
    const job = this.read(id)
    if (!['queued', 'failed', 'cancelled'].includes(job.state)) throw new Error('Cannot cancel a job that has started dispatch')
    this.database.connection.prepare("UPDATE jobs SET state='cancelled',updated_at=? WHERE id=?").run(Date.now(), id)
    return this.read(id)
  }

  settleInputs(): void {
    this.database.connection.prepare(`UPDATE jobs SET state=CASE (SELECT state FROM inputs WHERE id=jobs.input_id)
      WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' ELSE 'failed' END,
      error=CASE (SELECT state FROM inputs WHERE id=jobs.input_id) WHEN 'completed' THEN NULL ELSE COALESCE(
        (SELECT t.error FROM turns t JOIN inputs i ON i.turn_id=t.id WHERE i.id=jobs.input_id),
        'Durable input ended: ' || (SELECT state FROM inputs WHERE id=jobs.input_id)) END,
      updated_at=? WHERE state='dispatched' AND EXISTS(SELECT 1 FROM inputs WHERE id=jobs.input_id AND state IN ('completed','failed','interrupted','cancelled'))`).run(Date.now())
  }

  private owningTransaction(): void { if (!this.database.inTransaction) throw new Error('Job dispatch requires an owning transaction') }
}

function fromRow(row: Record<string, SQLOutputValue>): JobInfo {
  return jobInfoSchema.parse({ id: row.id, kind: row.kind, sessionId: row.session_id, dueAt: row.due_at, payload: JSON.parse(String(row.payload_json)),
    key: row.operation_key, causationId: row.causation_id, depth: row.depth, state: row.state, attempts: row.attempts, error: row.error,
    inputId: row.input_id, createdAt: row.created_at, updatedAt: row.updated_at })
}

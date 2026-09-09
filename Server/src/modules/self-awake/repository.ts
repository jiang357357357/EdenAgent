import { readNotificationHistory } from './notification-history.ts'
import { previewNotificationReview, resolveNotificationReview } from './notification-review.ts'
import { previewRunReview, resolveRunReview } from './run-review.ts'
import { recentSelfAwakeContacts } from './recent-contacts.ts'
import { JobRepository } from '../jobs/index.ts'
import { randomUUID } from 'node:crypto'
import type { SQLOutputValue } from 'node:sqlite'
import type { EdenDatabase } from '@eden/store'
import { selfAwakeListSchema, selfAwakeExecutionSchema, toJson } from '@eden/api'
import type { JobInfo, JsonValue, SelfAwakeDecision } from '@eden/api'

export class SelfAwakeRepository {
  constructor(readonly database: EdenDatabase) {}
  runReview(runId: string) { this.read(runId); return previewRunReview(this.database, runId) }
  resolveRun(runId: string, fingerprint: string, decision: 'completed' | 'failed', note: string) {
    this.read(runId)
    return resolveRunReview(this.database, runId, fingerprint, decision, note)
  }
  notificationReview(runId: string) { this.read(runId); return previewNotificationReview(this.database, runId) }
  resolveNotification(runId: string, fingerprint: string, decision: 'delivered' | 'suppressed', note: string) {
    this.read(runId)
    return resolveNotificationReview(this.database, runId, fingerprint, decision, note)
  }

  begin(job: JobInfo, request: JsonValue, author: JsonValue): string {
    const old = this.database.connection.prepare('SELECT id FROM self_awake_runs WHERE job_id=?').get(job.id)
    if (old) {
      this.database.connection.prepare("UPDATE self_awake_runs SET request_json=?,author_json=?,attempts=?,updated_at=? WHERE id=? AND state='preparing'")
        .run(JSON.stringify(request), JSON.stringify(author), job.attempts, Date.now(), old.id!)
      return String(old.id)
    }
    if (!job.sessionId) throw new Error('Self-awake requires a target session')
    const id = randomUUID(), now = Date.now()
    this.database.connection.prepare(`INSERT INTO self_awake_runs(id,job_id,session_id,event_id,state,request_json,author_json,attempts,created_at,updated_at)
      VALUES(?,?,?,?,'preparing',?,?,?,?,?)`).run(id, job.id, job.sessionId,
        request && typeof request === 'object' && !Array.isArray(request) ? String(request.event_id ?? '') : '', JSON.stringify(request), JSON.stringify(author), job.attempts, now, now)
    return id
  }

  dispatchedInTransaction(id: string, inputId: string, turnId: string): void {
    if (!this.database.inTransaction) throw new Error('Self-awake dispatch requires an owning transaction')
    this.database.connection.prepare("UPDATE self_awake_runs SET state='running',input_id=?,turn_id=?,started_at=?,updated_at=?,last_error=NULL WHERE id=?")
      .run(inputId, turnId, Date.now(), Date.now(), id)
  }

  fail(id: string, error: string): void {
    this.database.transaction(() => {
      const run = this.read(id), now = Date.now(), author = object(run.authorSnapshot)
      this.database.connection.prepare("UPDATE self_awake_runs SET state='failed',last_error=?,completed_at=?,updated_at=? WHERE id=?")
        .run(error.slice(0, 4000), now, now, id)
      this.database.connection.prepare(`INSERT INTO self_awake_diaries(id,run_id,session_id,assistant_id,character_id,title,content,mood,metadata_json,created_at)
        VALUES(?,?,?,?,?,?,?,'','{}',?) ON CONFLICT(run_id) DO NOTHING`).run(randomUUID(), id, run.sessionId,
          String(author.assistantId ?? ''), String(author.characterId ?? ''), '自醒未完成', error.slice(0, 4000), now)
    })
  }

  finish(id: string, decision: SelfAwakeDecision): void {
    this.database.transaction(() => {
      const run = this.read(id)
      if (run.status !== 'running') return
      const now = Date.now()
      const author = object(run.authorSnapshot)
      this.database.connection.prepare(`INSERT INTO self_awake_diaries(id,run_id,session_id,assistant_id,character_id,title,content,mood,metadata_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), id, run.sessionId, String(author.assistantId ?? ''), String(author.characterId ?? ''),
          decision.diary.title, decision.diary.content, decision.mood, JSON.stringify({ action: decision.action }), now)
      this.database.connection.prepare("UPDATE self_awake_runs SET state=?,decision_json=?,completed_at=?,updated_at=? WHERE id=?")
        .run(decision.action === 'write_diary' ? 'completed' : 'awaiting_action', JSON.stringify(decision), now, now, id)
    })
  }

  read(id: string) {
    selfAwakeExecutionSchema.parse({ runId: id })
    const row = this.database.connection.prepare('SELECT * FROM self_awake_runs WHERE id=?').get(id)
    if (!row) throw new Error('Self-awake run not found in this world')
    return this.fromRow(row)
  }

  list(params: unknown) {
    const input = selfAwakeListSchema.parse(params), query = input.query?.trim() ?? ''
    const where = "(?='' OR instr(lower(request_json),lower(?))>0 OR instr(lower(COALESCE(decision_json,'')),lower(?))"
    const count = Number(this.database.connection.prepare(`SELECT COUNT(*) AS count FROM self_awake_runs WHERE ${where}`).get(query, query, query)?.count ?? 0)
    const rows = this.database.connection.prepare(`SELECT * FROM self_awake_runs WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
      .all(query, query, query, input.pageSize, (input.page - 1) * input.pageSize)
    const next = this.database.connection.prepare("SELECT due_at,payload_json FROM jobs WHERE kind='self_awake' AND state='queued' ORDER BY due_at LIMIT 1").get()
    return { schedule: next ? { status: 'scheduled', nextWakeAt: new Date(Number(next.due_at)).toISOString(), reason: String(object(JSON.parse(String(next.payload_json))).prompt ?? '') } : null,
      count, page: input.page, pageSize: input.pageSize, totalPages: Math.ceil(count / input.pageSize), results: rows.map(row => this.fromRow(row)) }
  }

  pendingResults(): { id: string; inputId: string; state: string; turnId: string }[] {
    return this.database.connection.prepare(`SELECT r.id,r.input_id,r.turn_id,i.state FROM self_awake_runs r JOIN inputs i ON i.id=r.input_id
      WHERE r.state='running' AND i.state!='queued' AND i.state!='running' ORDER BY r.created_at LIMIT 100`).all()
      .map(row => ({ id: String(row.id), inputId: String(row.input_id), state: String(row.state), turnId: String(row.turn_id) }))
  }

  parentJob(sessionId: string, turnId: string) {
    const row = this.database.connection.prepare(`SELECT jobs.id FROM jobs JOIN inputs ON inputs.id=jobs.input_id WHERE inputs.session_id=? AND inputs.turn_id=?`).get(sessionId, turnId)
    return row ? new JobRepository(this.database).read(String(row.id)) : undefined
  }

  context(sessionId: string, turnId: string) {
    const row = this.database.connection.prepare('SELECT id FROM self_awake_runs WHERE session_id=? AND turn_id=?').get(sessionId, turnId)
    const diaries = this.database.connection.prepare('SELECT title,content,mood,created_at FROM self_awake_diaries WHERE session_id=? ORDER BY created_at DESC LIMIT 10').all(sessionId)
    return { current_time: new Date().toISOString(), run: row ? this.read(String(row.id)) : null,
      recent_diaries: diaries.map(diary => ({ title: diary.title, content: diary.content, mood: diary.mood, createdAt: diary.created_at })) }
  }

  ownsBackgroundSession(sessionId: string, userId: string): boolean {
    return Boolean(this.database.connection.prepare(`SELECT 1 FROM self_awake_submissions s
      JOIN jobs j ON j.id=s.job_id WHERE j.session_id=? AND s.user_id=? LIMIT 1`).get(sessionId, userId))
  }

  recentDiaries(sessionId: string, userId: string, limit: number) {
    const rows = this.database.connection.prepare(`SELECT d.* FROM self_awake_diaries d JOIN self_awake_runs r ON r.id=d.run_id
      WHERE (?='' AND d.session_id=?) OR (?!='' AND EXISTS (SELECT 1 FROM self_awake_submissions s JOIN jobs j ON j.id=s.job_id WHERE j.session_id=r.session_id AND s.user_id=?))
      ORDER BY d.created_at DESC,d.id DESC LIMIT ?`).all(userId, sessionId, userId, userId, limit)
    return rows.map(row => ({ id: row.id, sessionId: row.session_id, assistantId: row.assistant_id, characterId: row.character_id,
      title: row.title, content: row.content, mood: row.mood, createdAt: row.created_at }))
  }

  recentContacts(sessionId: string, userId: string, limit: number) {
    return recentSelfAwakeContacts(this.database, sessionId, userId, limit)
  }

  finalText(sessionId: string, turnId: string): string {
    const rows = this.database.connection.prepare("SELECT payload_json FROM events WHERE session_id=? AND turn_id=? AND kind='agent.message_end' ORDER BY seq DESC").all(sessionId, turnId)
    for (const row of rows) {
      const message = object(object(JSON.parse(String(row.payload_json))).message)
      if (message.role !== 'assistant') continue
      return typeof message.content === 'string' ? message.content : Array.isArray(message.content)
        ? message.content.map(object).filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('\n') : ''
    }
    return ''
  }

  execution(id: string) {
    const run = this.read(id)
    const row = this.database.connection.prepare('SELECT turn_id,action_result_json FROM self_awake_runs WHERE id=?').get(id)
    const events = this.database.connection.prepare('SELECT kind,payload_json,created_at FROM events WHERE session_id=? AND turn_id=? ORDER BY seq').all(run.sessionId, row?.turn_id ?? null)
    return { path: `eden-self-awake://${id}`, record: toJson({ run, notificationHistory: readNotificationHistory(this.database, id), actionResult: row?.action_result_json ? JSON.parse(String(row.action_result_json)) : null, events: events.map(event => ({ kind: event.kind, payload: JSON.parse(String(event.payload_json)), createdAt: event.created_at })) }) }
  }

  private fromRow(row: Record<string, SQLOutputValue>) {
    const review = this.database.connection.prepare('SELECT decision,note,created_at FROM self_awake_run_reviews WHERE run_id=?').get(row.id!)
    const diaries = this.database.connection.prepare('SELECT * FROM self_awake_diaries WHERE run_id=? ORDER BY created_at,id').all(row.id!)
    return { id: String(row.id), jobId: String(row.job_id), sessionId: String(row.session_id), schemaVersion: 'self-awake.v1', eventId: String(row.event_id),
      outcomeReview: review ? { decision: String(review.decision), note: String(review.note), reviewedAt: Number(review.created_at) } : null,
      status: String(row.state), request: toJson(JSON.parse(String(row.request_json))), decision: row.decision_json === null ? null : toJson(JSON.parse(String(row.decision_json))),
      authorSnapshot: toJson(JSON.parse(String(row.author_json))), attempts: Number(row.attempts), lastError: row.last_error === null ? null : String(row.last_error),
      startedAt: row.started_at === null ? null : Number(row.started_at), completedAt: row.completed_at === null ? null : Number(row.completed_at),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), diaries: diaries.map(diary => ({ id: String(diary.id), runId: String(diary.run_id),
        sessionId: String(diary.session_id), assistantId: String(diary.assistant_id), characterId: String(diary.character_id), title: String(diary.title),
        content: String(diary.content), mood: String(diary.mood), metadata: toJson(JSON.parse(String(diary.metadata_json))), createdAt: Number(diary.created_at) })) }
  }
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }

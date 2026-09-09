import type { EdenDatabase } from '@eden/store'
import type { JobInfo } from '@eden/api'
import type { JobRepository } from '../jobs/index.ts'
import { hookPayload } from './payload.ts'
export interface HookContribution { pluginId: string; revision: string; hookId: string; event: string; skillName: string; afterRowid: number }
export class PluginHookRepository {
  constructor(private readonly database: EdenDatabase, private readonly jobs: JobRepository) {}
  assertEvent(job: JobInfo) {
    const input = hookPayload.parse(job.payload)
    const event = this.database.connection.prepare('SELECT session_id,kind,created_at FROM events WHERE id=?').get(input.eventId)
    if (job.kind !== 'plugin.hook' || !job.sessionId || !event || event.session_id !== job.sessionId ||
      event.kind !== input.event || event.created_at !== input.occurredAt || job.causationId !== input.eventId) {
      throw new Error('Pinned hook event is missing or no longer matches its job')
    }
    return input
  }
  resubmit(id: string, expectedUpdatedAt: number, note: string, validate: (job: JobInfo) => void): JobInfo {
    return this.database.transaction(() => {
      const db = this.database.connection
      const previous = db.prepare('SELECT * FROM plugin_hook_resubmissions WHERE source_job_id=?').get(id)
      if (previous) {
        if (previous.expected_updated_at !== expectedUpdatedAt || previous.note !== note) throw new Error('Hook job was already resubmitted with different evidence')
        return this.jobs.read(String(previous.new_job_id))
      }
      const source = this.jobs.read(id)
      if (source.kind !== 'plugin.hook' || !['failed', 'cancelled'].includes(source.state) || source.updatedAt !== expectedUpdatedAt) throw new Error('Stop or review the original hook job, then reload it')
      this.assertEvent(source)
      if (source.inputId) {
        const input = db.prepare('SELECT state,turn_id FROM inputs WHERE id=?').get(source.inputId)
        if (input?.state !== 'cancelled') throw new Error('Explicitly stop the original hook input before resubmitting')
        if (db.prepare("SELECT 1 FROM tool_operations WHERE turn_id=? AND state IN ('running','unknown') LIMIT 1").get(input.turn_id!)) throw new Error('Reconcile unknown hook effects first')
      }
      validate(source)
      const next = this.jobs.scheduleInTransaction({ kind: source.kind, sessionId: source.sessionId,
        payload: source.payload, dueAt: Date.now(), key: `plugin-hook-resubmit:${id}`,
        causationId: source.causationId, depth: source.depth })
      db.prepare('INSERT INTO plugin_hook_resubmissions VALUES(?,?,?,?,?)').run(id, next.id, expectedUpdatedAt, note, Date.now())
      return next
    })
  }
  initialize() {
    this.database.connection.prepare("INSERT OR IGNORE INTO plugin_hook_cursor(id,after_rowid) SELECT 1,COALESCE(MAX(rowid),0) FROM events").run()
  }
  capture(hooks: HookContribution[]): boolean {
    return this.database.transaction(() => {
      const cursor = Number(this.database.connection.prepare('SELECT after_rowid FROM plugin_hook_cursor WHERE id=1').get()?.after_rowid ?? 0)
      const events = this.database.connection.prepare('SELECT rowid AS event_rowid,id,session_id,turn_id,kind,created_at FROM events WHERE rowid>? ORDER BY rowid LIMIT 200').all(cursor)
      for (const event of events) {
        const matches = hooks.filter(hook => hook.event === event.kind && Number(event.event_rowid) > hook.afterRowid)
        if (!matches.length) continue
        const session = this.database.connection.prepare("SELECT 1 FROM sessions WHERE id=? AND status='active'").get(event.session_id!)
        if (!session) continue
        const parent = this.database.connection.prepare('SELECT j.depth FROM jobs j JOIN inputs i ON i.id=j.input_id WHERE i.session_id=? AND i.turn_id=? LIMIT 1').get(event.session_id!, event.turn_id ?? null)
        const depth = parent ? Number(parent.depth) + 1 : 0
        if (depth > 8) continue
        for (const hook of matches) this.jobs.scheduleInTransaction({ kind: 'plugin.hook', sessionId: String(event.session_id), dueAt: Date.now(),
          payload: { pluginId: hook.pluginId, revision: hook.revision, hookId: hook.hookId, skillName: hook.skillName, eventId: String(event.id), event: String(event.kind), occurredAt: Number(event.created_at) },
          key: `plugin-hook:${hook.pluginId}:${hook.revision}:${hook.hookId}:${String(event.id)}`, causationId: String(event.id), depth })
      }
      if (events.length) this.database.connection.prepare('UPDATE plugin_hook_cursor SET after_rowid=? WHERE id=1').run(events.at(-1)!.event_rowid!)
      return events.length === 200
    })
  }
}

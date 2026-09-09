import { z } from 'zod'
import type { EdenDatabase } from '@eden/store'
import type { JobRepository } from '../jobs/index.ts'
const payloadSchema = z.object({ agentId: z.string().uuid(), message: z.string().min(1).max(64000).refine(value => Boolean(value.trim())) }).strict()

export class SubagentJobResubmission {
  constructor(private readonly database: EdenDatabase, private readonly jobs: JobRepository) {}
  existing(agentId: string, jobId: string, updatedAt: number, note: string): boolean {
    const row = this.database.connection.prepare('SELECT * FROM subagent_job_resubmissions WHERE source_job_id=?').get(jobId)
    if (!row) return false
    if (row.agent_id !== agentId || row.expected_updated_at !== updatedAt || row.note !== note) throw new Error('Job was already resubmitted with different evidence')
    return true
  }
  source(agentId: string, jobId: string, updatedAt: number) {
    const job = this.jobs.read(jobId), db = this.database.connection
    const thread = db.prepare('SELECT child_session_id FROM subagent_threads WHERE id=?').get(agentId)
    if (!thread || job.sessionId !== thread.child_session_id || job.kind !== 'subagent.turn') throw new Error('Job does not belong to this subagent execution workflow')
    if (!['cancelled','failed'].includes(job.state) || job.updatedAt !== updatedAt) throw new Error('Stop or review the original job and reload before resubmitting')
    if (job.inputId) {
      const input = db.prepare('SELECT state,turn_id FROM inputs WHERE id=? AND session_id=?').get(job.inputId, job.sessionId)
      if (input?.state !== 'cancelled') throw new Error('Explicitly stop the original input before resubmitting its job')
      if (db.prepare("SELECT 1 FROM tool_operations WHERE session_id=? AND turn_id=? AND state IN ('running','unknown') LIMIT 1").get(job.sessionId, input.turn_id!)) throw new Error('Reconcile unknown effects before repeating this task')
    }
    const payload = payloadSchema.parse(job.payload)
    if (payload.agentId !== agentId) throw new Error('Job payload has conflicting subagent ownership')
    return payload.message
  }
  record(agentId: string, jobId: string, updatedAt: number, note: string, key: string) {
    if (!this.database.inTransaction) throw new Error('Job resubmission must commit with the task follow-up')
    this.source(agentId, jobId, updatedAt)
    const created = this.jobs.byKey(`agent-followup:${agentId}:${key}`)
    if (!created) throw new Error('Follow-up job was not durably accepted')
    this.database.connection.prepare('INSERT INTO subagent_job_resubmissions VALUES(?,?,?,?,?,?)')
      .run(jobId, agentId, updatedAt, created.id, note, Date.now())
  }
}

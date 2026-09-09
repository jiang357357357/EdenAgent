import type { EdenDatabase } from '@eden/store'
import type { JobRepository } from '../jobs/index.ts'
import type { JobSchedule } from '@eden/api'

export class SelfAwakeBridgeRepository {
  constructor(private readonly database: EdenDatabase, private readonly jobs: JobRepository) {}
  consumeNonce(nonce: string, expiresAt: number): void {
    this.database.transaction(() => {
      this.database.connection.prepare('DELETE FROM service_nonces WHERE expires_at<?').run(Date.now())
      if (Number(this.database.connection.prepare('SELECT COUNT(*) AS count FROM service_nonces').get()?.count) >= 10000) throw new Error('Service nonce capacity reached')
      this.database.connection.prepare('INSERT INTO service_nonces(nonce,expires_at) VALUES(?,?)').run(nonce, expiresAt)
    })
  }
  existing(user: string, key: string, hash: string) {
    const row = this.database.connection.prepare('SELECT job_id,request_hash FROM self_awake_submissions WHERE user_id=? AND request_key=?').get(user, key)
    if (!row) return undefined
    if (row.request_hash !== hash) throw new Error('Idempotency key was used with a different request')
    return this.jobs.read(String(row.job_id))
  }
  submit(user: string, key: string, hash: string, input: JobSchedule) {
    return this.database.transaction(() => {
      const existing = this.existing(user, key, hash)
      if (existing) return existing
      const job = this.jobs.scheduleInTransaction(input)
      this.database.connection.prepare('INSERT INTO self_awake_submissions(user_id,request_key,request_hash,job_id) VALUES(?,?,?,?)').run(user, key, hash, job.id)
      return job
    })
  }
  status(user: string, id: string) {
    if (!this.database.connection.prepare('SELECT 1 FROM self_awake_submissions WHERE user_id=? AND job_id=?').get(user, id)) throw new Error('Self-awake job owner mismatch')
    const job = this.jobs.read(id)
    const run = this.database.connection.prepare('SELECT id,state,decision_json,last_error,updated_at FROM self_awake_runs WHERE job_id=?').get(id)
    return { id: run ? String(run.id) : id, status: job.state === 'failed' ? 'failed' : String(run?.state ?? job.state),
      decision_payload: run?.decision_json ? JSON.parse(String(run.decision_json)) : null,
      error: run?.last_error ?? job.error, updated_at: new Date(Number(run?.updated_at ?? job.updatedAt)).toISOString() }
  }
}

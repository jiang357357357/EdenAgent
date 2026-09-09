import type { EdenDatabase } from '@eden/store'

/** Explicitly settle dispatch uncertainty without retrying any external effect. */
export function resolveJobOutcome(database: EdenDatabase, id: string, expectedUpdatedAt: number,
  decision: 'completed' | 'cancelled', note: string): void {
  database.transaction(() => {
    const db = database.connection
    const previous = db.prepare('SELECT * FROM job_outcome_reviews WHERE job_id=?').get(id)
    if (previous) {
      if (previous.expected_updated_at !== expectedUpdatedAt || previous.decision !== decision || previous.note !== note) throw new Error('Job outcome already reviewed with different evidence')
      return
    }
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(id)
    if (!job || job.state !== 'unknown') throw new Error('Job is not awaiting outcome review')
    if (job.updated_at !== expectedUpdatedAt) throw new Error('Job changed; reload its evidence before reviewing')
    if (job.input_id != null) {
      const input = db.prepare('SELECT state FROM inputs WHERE id=?').get(job.input_id)
      if (!input || input.state !== decision) throw new Error('Resolve the linked durable input to the same outcome first')
    }
    db.prepare('INSERT INTO job_outcome_reviews VALUES(?,?,?,?,?)').run(id, expectedUpdatedAt, decision, note, Date.now())
    db.prepare('UPDATE jobs SET state=?,error=?,updated_at=? WHERE id=?')
      .run(decision, decision === 'completed' ? null : 'User stopped further dispatch after reviewing the unknown outcome', Date.now(), id)
  })
}

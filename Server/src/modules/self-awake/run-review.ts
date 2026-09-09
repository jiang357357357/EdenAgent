import { createHash } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'

export function previewRunReview(database: EdenDatabase, runId: string) {
  const row = database.connection.prepare('SELECT * FROM self_awake_runs WHERE id=?').get(runId)
  if (!row) throw new Error('Self-awake run not found')
  return { fingerprint: createHash('sha256').update(JSON.stringify(row)).digest('hex'), state: String(row.state) }
}

export function resolveRunReview(database: EdenDatabase, runId: string, fingerprint: string, decision: 'completed' | 'failed', note: string) {
  return database.transaction(() => {
    const db = database.connection
    const previous = db.prepare('SELECT * FROM self_awake_run_reviews WHERE run_id=?').get(runId)
    if (previous) {
      if (previous.fingerprint !== fingerprint || previous.decision !== decision || previous.note !== note) throw new Error('Self-awake run already reviewed with different evidence')
      return previewRunReview(database, runId)
    }
    const preview = previewRunReview(database, runId)
    if (preview.state !== 'interrupted' || preview.fingerprint !== fingerprint) throw new Error('Reload the interrupted self-awake record before reviewing')
    const row = db.prepare('SELECT * FROM self_awake_runs WHERE id=?').get(runId)!
    const job = db.prepare('SELECT state FROM jobs WHERE id=?').get(row.job_id!)
    if (!job || !['completed', 'failed', 'cancelled'].includes(String(job.state))) throw new Error('Resolve the original self-awake job outcome first')
    if (row.input_id) {
      const input = db.prepare('SELECT state FROM inputs WHERE id=?').get(row.input_id)
      if (!input || !['completed', 'failed', 'cancelled'].includes(String(input.state))) throw new Error('Resolve the original self-awake input first')
    }
    if (decision === 'completed' && row.turn_id && db.prepare("SELECT 1 FROM tool_operations WHERE turn_id=? AND state IN ('running','unknown') LIMIT 1").get(row.turn_id)) throw new Error('Reconcile unknown tool effects before confirming completion')
    const now = Date.now()
    db.prepare('INSERT INTO self_awake_run_reviews VALUES(?,?,?,?,?,?)').run(runId, fingerprint, JSON.stringify(row), decision, note, now)
    db.prepare('UPDATE self_awake_runs SET state=?,completed_at=COALESCE(completed_at,?),updated_at=? WHERE id=?').run(decision, now, now, runId)
    return previewRunReview(database, runId)
  })
}

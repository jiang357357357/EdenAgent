import { createHash } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import { readNotificationHistory } from './notification-history.ts'

export function previewNotificationReview(database: EdenDatabase, runId: string) {
  const row = database.connection.prepare('SELECT * FROM self_awake_notification_history WHERE run_id=?').get(runId)
  if (!row) return null
  return { fingerprint: createHash('sha256').update(JSON.stringify(row)).digest('hex'), record: readNotificationHistory(database, runId), state: String(row.state) }
}

export function resolveNotificationReview(database: EdenDatabase, runId: string, fingerprint: string, decision: 'delivered' | 'suppressed', note: string) {
  return database.transaction(() => {
    const db = database.connection
    const previous = db.prepare('SELECT * FROM self_awake_notification_reviews WHERE run_id=?').get(runId)
    if (previous) {
      if (previous.fingerprint !== fingerprint || previous.decision !== decision || previous.note !== note) throw new Error('Historical notification already reviewed with different evidence')
      return previewNotificationReview(database, runId)!
    }
    const preview = previewNotificationReview(database, runId)
    if (!preview || preview.state !== 'unknown' || preview.fingerprint !== fingerprint) throw new Error('Historical notification changed or does not require review; reload its evidence')
    const row = db.prepare('SELECT * FROM self_awake_notification_history WHERE run_id=?').get(runId)
    const now = Date.now()
    db.prepare('INSERT INTO self_awake_notification_reviews VALUES(?,?,?,?,?,?,?)').run(runId, fingerprint, JSON.stringify(row), decision, note, now, 'manual')
    db.prepare('UPDATE self_awake_notification_history SET state=?,updated_at=? WHERE run_id=?').run(decision, now, runId)
    return previewNotificationReview(database, runId)!
  })
}

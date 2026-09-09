import type { EdenDatabase } from '@eden/store'
import { toJson } from '@eden/api'

export function readNotificationHistory(database: EdenDatabase, runId: string) {
  const row = database.connection.prepare('SELECT * FROM self_awake_notification_history WHERE run_id=?').get(runId)
  if (!row) return null
  const review = database.connection.prepare('SELECT decision,note,created_at FROM self_awake_notification_reviews WHERE run_id=?').get(runId)
  return toJson({ source: 'legacy', runId, requestedChannel: String(row.requested_channel), state: String(row.state),
    originalState: String(row.original_state), payload: JSON.parse(String(row.payload_json)),
    result: row.result_json === null ? null : JSON.parse(String(row.result_json)), attempts: Number(row.attempts),
    lastError: row.last_error === null ? null : String(row.last_error), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    review: review ? { decision: String(review.decision), note: String(review.note), reviewedAt: Number(review.created_at), source: 'manual' } : null,
    automaticReplay: false, interpretation: 'Historical transport record. Manual review is identified separately; delivered does not imply a user response. Suppressed stops further delivery and does not prove no earlier side effects.' })
}

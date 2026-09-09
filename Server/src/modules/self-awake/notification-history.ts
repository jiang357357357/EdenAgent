import type { EdenDatabase } from '@eden/store'
import { toJson } from '@eden/api'

export function readNotificationHistory(database: EdenDatabase, runId: string) {
  const row = database.connection.prepare('SELECT * FROM self_awake_notification_history WHERE run_id=?').get(runId)
  if (!row) return null
  return toJson({ source: 'legacy', runId, requestedChannel: String(row.requested_channel), state: String(row.state),
    originalState: String(row.original_state), payload: JSON.parse(String(row.payload_json)),
    result: row.result_json === null ? null : JSON.parse(String(row.result_json)), attempts: Number(row.attempts),
    lastError: row.last_error === null ? null : String(row.last_error), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    automaticReplay: false, interpretation: 'Historical transport record. Delivered is the old host receipt, not evidence of a user response; unknown requires review.' })
}

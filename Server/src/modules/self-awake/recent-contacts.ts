import type { EdenDatabase } from '@eden/store'

/** Summarize local delivery evidence only; transport payloads and recipient credentials stay private. */
export function recentSelfAwakeContacts(database: EdenDatabase, sessionId: string, userId: string, limit: number) {
  const count = Math.max(1, Math.min(20, Math.trunc(limit)))
  const rows = database.connection.prepare(`WITH contacts AS (
    SELECT 'desktop:' || n.id AS id,n.session_id,'desktop' AS channel,n.state,n.title,n.message,
      n.created_at,n.displayed_at,n.closed_at,'desktop_reminder' AS source,NULL AS review_decision,n.author_json
      FROM desktop_reminders n
    UNION ALL
    SELECT 'contact:' || c.request_id,c.session_id,c.channel,c.state,
      json_extract(r.decision_json,'$.action_payload.title'),json_extract(r.decision_json,'$.action_payload.message'),
      c.created_at,NULL,NULL,'contact_receipt',NULL,r.author_json FROM mon_contact_deliveries c
      LEFT JOIN self_awake_runs r ON c.request_id='self-awake:' || r.id || ':' || c.channel
    UNION ALL
    SELECT 'legacy:' || h.run_id,r.session_id,h.requested_channel,h.state,
      json_extract(r.decision_json,'$.action_payload.title'),json_extract(r.decision_json,'$.action_payload.message'),
      h.created_at,NULL,NULL,'legacy_notification',v.decision,r.author_json
      FROM self_awake_notification_history h JOIN self_awake_runs r ON r.id=h.run_id
      LEFT JOIN self_awake_notification_reviews v ON v.run_id=h.run_id
  ) SELECT * FROM contacts n WHERE (?='' AND n.session_id=?) OR
    (?!='' AND EXISTS(SELECT 1 FROM self_awake_submissions s JOIN jobs j ON j.id=s.job_id
      WHERE j.session_id=n.session_id AND s.user_id=?))
    ORDER BY n.created_at DESC,n.id DESC LIMIT ?`).all(userId, sessionId, userId, userId, count)
  const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : ''
  return rows.map(row => ({ id: String(row.id), sessionId: String(row.session_id), channel: String(row.channel),
    status: String(row.state), title: text(row.title, 1000), message: text(row.message, 4000),
    createdAt: Number(row.created_at), displayedAt: row.displayed_at === null ? null : Number(row.displayed_at),
    closedAt: row.closed_at === null ? null : Number(row.closed_at), source: String(row.source),
    author: row.author_json === null ? null : JSON.parse(String(row.author_json)),
    manualDecision: row.review_decision === null ? null : String(row.review_decision) }))
}

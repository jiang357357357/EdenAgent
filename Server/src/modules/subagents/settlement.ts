import type { EdenDatabase } from '@eden/store'

/** Only terminal durable inputs can settle a child; tool/user messages are not task answers. */
export function settleSubagentThreads(database: EdenDatabase): void {
  database.transaction(() => {
    const rows = database.connection.prepare(`SELECT t.id,t.latest_job_id,j.state,j.error,j.input_id FROM subagent_threads t JOIN jobs j ON j.id=t.latest_job_id
      WHERE t.state IN ('queued','running') AND j.state IN ('completed','failed','cancelled','unknown')`).all()
    for (const row of rows) {
      const event = database.connection.prepare(`SELECT e.payload_json FROM events e JOIN inputs i ON i.session_id=e.session_id AND i.turn_id=e.turn_id
        WHERE i.id=? AND e.kind='agent.message_end' AND json_extract(e.payload_json,'$.message.role')='assistant'
        ORDER BY e.seq DESC LIMIT 1`).get(row.input_id ?? null)
      const payload = event ? JSON.parse(String(event.payload_json)) : null
      const message = payload?.message
      const content = typeof message?.content === 'string' ? message.content : Array.isArray(message?.content)
        ? message.content.filter((block: unknown) => block !== null && typeof block === 'object' && 'type' in block && block.type === 'text')
          .map((block: { text?: unknown }) => typeof block.text === 'string' ? block.text : '').join('\n') : ''
      const missingAnswer = row.state === 'completed' && !event
      const state = row.state === 'completed' && !missingAnswer ? 'completed' : row.state === 'cancelled' ? 'interrupted' : 'failed'
      const error = missingAnswer ? 'Task input completed without a durable assistant answer' : row.error ?? (row.state === 'unknown' ? 'Task outcome is unknown; inspect operation records before retrying' : null)
      const result = state === 'completed' ? JSON.stringify({ content, summary: content.slice(0, 1000), artifacts: [], changedFiles: [], tests: [] }) : null
      database.connection.prepare("UPDATE subagent_threads SET state=?,result_json=?,error=?,completed_at=?,updated_at=? WHERE id=? AND latest_job_id=? AND state IN ('queued','running')")
        .run(state, result, error, Date.now(), Date.now(), row.id!, row.latest_job_id!)
    }
  })
}

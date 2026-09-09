import { createHash } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import type { MonClient } from '@eden/integrations'
export class ProjectionDelivery {
  constructor(private readonly database: EdenDatabase) {}
  async deliver(client: MonClient, sessionId: string, destination: string, eventId: string, remoteId: string,
    kind: 'message' | 'director', body: import('@eden/api').JsonValue, signal: AbortSignal) {
    const db = this.database.connection, id = createHash('sha256').update(destination + ':' + eventId).digest('hex')
    db.prepare("INSERT INTO mon_projection_outbox VALUES(?,?,?,?,?,'pending',NULL,NULL,?,?) ON CONFLICT(id) DO NOTHING")
      .run(id, sessionId, destination, kind, JSON.stringify(body), Date.now(), Date.now())
    const record = db.prepare('SELECT state,payload_json FROM mon_projection_outbox WHERE id=?').get(id)!
    if (record.state === 'applied') return
    db.prepare("UPDATE mon_projection_outbox SET state='running',updated_at=? WHERE id=?").run(Date.now(), id)
    try {
      const response = await client.post(`/api/agent/sessions/${remoteId}/${kind === 'message' ? 'messages' : 'director-runs'}/`, JSON.parse(String(record.payload_json)), signal)
      if (!response || typeof response !== 'object' || Array.isArray(response) || response.sync_status === 'failed') throw new Error('Invalid Core message projection response')
      db.prepare("UPDATE mon_projection_outbox SET state='applied',error=NULL,updated_at=? WHERE id=?").run(Date.now(), id)
    } catch (error) {
      db.prepare("UPDATE mon_projection_outbox SET state='unknown',error='Core projection was not confirmed',updated_at=? WHERE id=?").run(Date.now(), id)
      throw error
    }
  }
}

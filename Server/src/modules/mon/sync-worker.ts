import { ProjectionDelivery } from './projection-delivery.ts'
import { directorProjection } from './director-projection.ts'
import { createHash } from 'node:crypto'
import { MonClient } from '@eden/integrations'
import type { SessionRepository } from '../sessions/index.ts'
import type { MonConnectionRepository } from './connection-repository.ts'
import type { MonSessionProjection } from './session-projection.ts'
import { messageProjection } from './message-projection.ts'
export class MonSyncWorker {
  private readonly delivery: ProjectionDelivery
  private readonly abort = new AbortController()
  private timer: ReturnType<typeof setInterval> | undefined
  private task: Promise<void> | undefined
  constructor(private readonly sessions: SessionRepository, private readonly connections: MonConnectionRepository,
    private readonly projection: MonSessionProjection) { this.delivery = new ProjectionDelivery(sessions.database) }
  start() {
    if (this.timer || this.abort.signal.aborted) return
    const tick = () => {
      if (this.task) return
      this.task = this.sweep().catch(() => { process.stderr.write('Mon sync discovery failed; pending events remain durable\n') })
        .finally(() => { this.task = undefined })
    }
    this.timer = setInterval(tick, 2000); this.timer.unref(); tick()
  }
  private async sweep() {
    const db = this.sessions.database.connection
    const rows = db.prepare(`SELECT c.session_id FROM mon_connections c JOIN sessions s ON s.id=c.session_id
      WHERE s.status!='deleted' ORDER BY c.session_id`).all()
    for (const row of rows) {
      if (this.abort.signal.aborted) return
      const sessionId = String(row.session_id), connection = this.connections.readForSync(sessionId)
      if (!connection) continue
      const environment = this.sessions.read(sessionId).environment
      if (environment && typeof environment === 'object' && !Array.isArray(environment) &&
        (environment.sessionPurpose === 'self_awake' || environment.subagent)) continue
      const destination = JSON.stringify(connection), key = createHash('sha256').update(destination).digest('hex')
      db.prepare('INSERT INTO mon_sync_progress VALUES(?,?,\'0\',0,0,NULL) ON CONFLICT(session_id,destination_key) DO NOTHING').run(sessionId, key)
      const progress = db.prepare('SELECT * FROM mon_sync_progress WHERE session_id=? AND destination_key=?').get(sessionId, key)!
      if (Number(progress.retry_at) > Date.now()) continue
      try {
        const events = this.sessions.events.list(sessionId, String(progress.after_seq), 100)
        if (!events.length) continue
        const client = new MonClient(connection.coreBaseUrl, connection.coreToken)
        const remoteId = await this.projection.ensure(client, sessionId, destination, this.abort.signal)
        await this.deliverEvents(events, client, sessionId, key, remoteId)
      } catch {
        const attempts = Math.min(20, Number(progress.attempts) + 1)
        db.prepare('UPDATE mon_sync_progress SET attempts=?,retry_at=?,error=? WHERE session_id=? AND destination_key=?')
          .run(attempts, Date.now() + Math.min(300000, 2000 * 2 ** attempts), 'Mon projection delivery was not confirmed', sessionId, key)
      }
    }

  }
  async close() { if (this.timer) clearInterval(this.timer); this.abort.abort(); await this.task }

  private async deliverEvents(events: ReturnType<SessionRepository['events']['list']>, client: MonClient, sessionId: string, key: string, remoteId: string) {
    const db = this.sessions.database.connection

    for (const event of events) {
      if (event.kind === 'agent.message_end') {
        const body = messageProjection(this.sessions, event)
        if (body) await this.delivery.deliver(client, sessionId, key, event.id, remoteId, 'message', body, this.abort.signal)
      }
      const director = directorProjection(event)
      if (director) await this.delivery.deliver(client, sessionId, key, event.id, remoteId, 'director', director, this.abort.signal)
      db.prepare('UPDATE mon_sync_progress SET after_seq=?,attempts=0,retry_at=0,error=NULL WHERE session_id=? AND destination_key=?')
        .run(event.seq, sessionId, key)
    }

  }
}

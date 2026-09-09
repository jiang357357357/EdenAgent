import { z } from 'zod'
import { modelCatalogSchema } from '@eden/api'
import type { EdenDatabase } from '@eden/store'

const connectionSchema = modelCatalogSchema.pick({ coreBaseUrl: true, coreToken: true })
export type MonConnection = z.infer<typeof connectionSchema>

/** Private verified connection credentials. Never serialize this repository's values into public events. */
export class MonConnectionRepository {
  constructor(private readonly database: EdenDatabase) {
    if (database.connection.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== 'mon') throw new Error('Core connections require the Mon database')
  }

  saveInTransaction(sessionId: string, value: MonConnection): void {
    if (!this.database.inTransaction) throw new Error('Core connection requires an owning transaction')
    z.uuid().parse(sessionId)
    const connection = connectionSchema.parse(value)
    if (!this.database.connection.prepare("SELECT 1 FROM sessions WHERE id=? AND status='active'").get(sessionId)) throw new Error('Core connection requires an active session')
    this.database.connection.prepare(`INSERT INTO mon_connections(session_id,core_base_url,core_token,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET core_base_url=excluded.core_base_url,core_token=excluded.core_token,updated_at=excluded.updated_at`)
      .run(sessionId, connection.coreBaseUrl, connection.coreToken, Date.now())
  }

  read(sessionId: string): MonConnection | undefined { return this.lookup(sessionId, false) }

  readForSync(sessionId: string): MonConnection | undefined { return this.lookup(sessionId, true) }

  private lookup(sessionId: string, includeClosed: boolean): MonConnection | undefined {
    z.uuid().parse(sessionId)
    const row = this.database.connection.prepare(`SELECT core_base_url,core_token FROM mon_connections JOIN sessions ON sessions.id=mon_connections.session_id
      WHERE session_id=? AND (sessions.status='active' OR (? AND sessions.status='closed'))`).get(sessionId, Number(includeClosed))
    return row ? connectionSchema.parse({ coreBaseUrl: row.core_base_url, coreToken: row.core_token }) : undefined
  }
}

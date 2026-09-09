import type { EdenDatabase } from '@eden/store'
import type { RuntimeModel } from '@eden/runtime-pi'
import { configuredModelSchema } from '@eden/api'

export class LocalChildModels {
  constructor(private readonly database: EdenDatabase) {}
  save(sessionId: string, model: RuntimeModel): void {
    if (this.database.connection.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== 'local') throw new Error('Local child model settings require the local world')
    const { apiKey: _apiKey, ...configuration } = configuredModelSchema.parse(model)
    this.database.connection.prepare('INSERT INTO local_child_models VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET configuration_json=excluded.configuration_json,updated_at=excluded.updated_at')
      .run(sessionId, JSON.stringify(configuration), Date.now())
  }
  resolve(sessionId: string, configured: RuntimeModel | undefined): RuntimeModel | undefined {
    const row = this.database.connection.prepare('SELECT configuration_json FROM local_child_models WHERE session_id=?').get(sessionId)
    if (!row) return configured
    if (!configured) throw new Error('Local parent provider is no longer configured')
    const saved = configuredModelSchema.parse(JSON.parse(String(row.configuration_json)))
    if (saved.provider !== configured.provider || saved.baseUrl !== configured.baseUrl) throw new Error('Local provider changed; child model ownership must be rebound')
    return { ...saved, ...(configured.apiKey ? { apiKey: configured.apiKey } : {}) }
  }
  remove(sessionId: string): void { this.database.connection.prepare('DELETE FROM local_child_models WHERE session_id=?').run(sessionId) }
}

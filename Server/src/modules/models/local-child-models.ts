import type { EdenDatabase } from '@eden/store'
import type { RuntimeModel } from '@eden/runtime-pi'
import { LocalModelProfiles } from './local-model-profiles.ts'
import { configuredModelSchema } from '@eden/api'

export class LocalChildModels {
  readonly profiles: LocalModelProfiles
  constructor(private readonly database: EdenDatabase) { this.profiles = new LocalModelProfiles(database) }
  saveInTransaction(sessionId: string, model: RuntimeModel, independent = false): void {
    if (!this.database.inTransaction) throw new Error('Recovered model activation requires an owning transaction')
    this.save(sessionId, model, independent)
  }
  save(sessionId: string, model: RuntimeModel, independent = false): void {
    if (this.database.connection.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== 'local') throw new Error('Local child model settings require the local world')
    const parsed = configuredModelSchema.parse(model)
    const { apiKey: _apiKey, ...publicModel } = parsed
    const configuration = independent ? parsed : publicModel
    this.database.connection.prepare('INSERT INTO local_child_models(session_id,configuration_json,updated_at,independent) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET configuration_json=excluded.configuration_json,updated_at=excluded.updated_at,independent=excluded.independent')
      .run(sessionId, JSON.stringify(configuration), Date.now(), Number(independent))
  }
  isIndependent(sessionId: string): boolean { return this.database.connection.prepare('SELECT independent FROM local_child_models WHERE session_id=?').get(sessionId)?.independent === 1 }
  resolve(sessionId: string, configured: RuntimeModel | undefined): RuntimeModel | undefined {
    const row = this.database.connection.prepare('SELECT configuration_json,independent FROM local_child_models WHERE session_id=?').get(sessionId)
    if (!row) return configured
    if (row.independent === 1) return configuredModelSchema.parse(JSON.parse(String(row.configuration_json)))
    if (!configured) throw new Error('Local parent provider is no longer configured')
    const saved = configuredModelSchema.parse(JSON.parse(String(row.configuration_json)))
    if (saved.provider !== configured.provider || saved.baseUrl !== configured.baseUrl) throw new Error('Local provider changed; child model ownership must be rebound')
    return { ...saved, ...(configured.apiKey ? { apiKey: configured.apiKey } : {}) }
  }
  remove(sessionId: string): void { this.database.connection.prepare('DELETE FROM local_child_models WHERE session_id=?').run(sessionId) }
}

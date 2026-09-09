import { randomUUID } from 'node:crypto'
import { configuredModelSchema } from '@eden/api'
import type { RuntimeModel } from '@eden/runtime-pi'
import type { EdenDatabase } from '@eden/store'

/** Private local-world credentials; public reads project metadata only. */
export class LocalModelProfiles {
  constructor(private readonly database: EdenDatabase) {}
  private assertLocal() {
    if (this.database.connection.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== 'local') throw new Error('Independent provider profiles require the local world')
  }
  list() {
    this.assertLocal()
    return this.database.connection.prepare('SELECT * FROM local_model_profiles ORDER BY model_key').all().map(row => {
      const { apiKey, ...model } = configuredModelSchema.parse(JSON.parse(String(row.configuration_json)))
      return { key: String(row.model_key), revision: String(row.revision), model, hasCredential: Boolean(apiKey) }
    })
  }
  save(model: RuntimeModel, expectedRevision: string | null) {
    this.assertLocal()
    const parsed = configuredModelSchema.parse(model), key = `${parsed.provider}/${parsed.id}`
    if (parsed.provider.includes('/')) throw new Error('Profile provider must not contain a slash')
    if (Buffer.byteLength(JSON.stringify(parsed)) > 32768) throw new Error('Model configuration exceeds size limit')
    return this.database.transaction(() => {
      const db = this.database.connection
      const old = db.prepare('SELECT revision FROM local_model_profiles WHERE model_key=?').get(key)
      if ((old?.revision ?? null) !== expectedRevision) throw new Error('Model profile changed; reload before saving')
      const revision = randomUUID()
      db.prepare('INSERT INTO local_model_profiles VALUES(?,?,?,?) ON CONFLICT(model_key) DO UPDATE SET configuration_json=excluded.configuration_json,revision=excluded.revision,updated_at=excluded.updated_at')
        .run(key, JSON.stringify(parsed), revision, Date.now())
      return { key, revision }
    })
  }
  remove(key: string, expectedRevision: string) {
    this.assertLocal()
    const result = this.database.connection.prepare('DELETE FROM local_model_profiles WHERE model_key=? AND revision=?').run(key, expectedRevision)
    if (!result.changes) throw new Error('Model profile changed or was removed; reload')
    return { key }
  }
  resolve(key: string): RuntimeModel | undefined {
    this.assertLocal()
    const row = this.database.connection.prepare('SELECT configuration_json FROM local_model_profiles WHERE model_key=?').get(key)
    return row ? configuredModelSchema.parse(JSON.parse(String(row.configuration_json))) : undefined
  }
}

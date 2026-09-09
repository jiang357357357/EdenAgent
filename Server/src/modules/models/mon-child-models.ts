import { createHash, randomUUID } from 'node:crypto'
import { configuredModelSchema, actorIdSchema } from '@eden/api'
import type { EdenDatabase } from '@eden/store'
import type { ModelBinding } from './contracts.ts'

export class MonChildModels {
  constructor(private readonly database: EdenDatabase) {}
  private connectionHash(sessionId: string) {
    const db = this.database.connection
    if (db.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()?.value !== 'mon') throw new Error('Mon child profiles require the Mon world')
    const row = db.prepare('SELECT core_base_url,core_token FROM mon_connections WHERE session_id=?').get(sessionId)
    if (!row) throw new Error('Bind the parent session to Mon Core before choosing child models')
    return createHash('sha256').update(JSON.stringify(row)).digest('hex')
  }
  list(sessionId: string) {
    const hash = this.connectionHash(sessionId)
    return this.database.connection.prepare('SELECT model_key,entity_id,revision,connection_hash FROM mon_child_models WHERE session_id=? ORDER BY model_key').all(sessionId)
      .map(row => ({ key: String(row.model_key), entityId: String(row.entity_id), revision: String(row.revision), current: row.connection_hash === hash }))
  }
  save(sessionId: string, binding: ModelBinding, expectedRevision: string | null, expectedConnectionHash: string) {
    const model = configuredModelSchema.parse(binding.model), entityId = String(actorIdSchema.parse(binding.entityId)), key = `${model.provider}/${model.id}`
    if (model.provider.includes('/') || Buffer.byteLength(JSON.stringify(model)) > 32768) throw new Error('Invalid independent Mon model configuration')
    return this.database.transaction(() => {
      const hash = this.connectionHash(sessionId), db = this.database.connection
      if (hash !== expectedConnectionHash) throw new Error('Mon connection changed while resolving the entity')
      const old = db.prepare('SELECT revision FROM mon_child_models WHERE session_id=? AND model_key=?').get(sessionId, key)
      if ((old?.revision ?? null) !== expectedRevision) throw new Error('Child model profile changed; reload its revision')
      const revision = randomUUID()
      db.prepare(`INSERT INTO mon_child_models VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_id,model_key) DO UPDATE SET
        entity_id=excluded.entity_id,binding_json=excluded.binding_json,connection_hash=excluded.connection_hash,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(sessionId, key, entityId, JSON.stringify({ ...binding, model }), hash, revision, Date.now())
      return { key, entityId, revision }
    })
  }
  captureConnection(sessionId: string) { return this.connectionHash(sessionId) }
  resolve(sessionId: string, key: string): ModelBinding | undefined {
    const row = this.database.connection.prepare('SELECT binding_json,connection_hash FROM mon_child_models WHERE session_id=? AND model_key=?').get(sessionId, key)
    if (!row) return undefined
    if (row.connection_hash !== this.connectionHash(sessionId)) throw new Error('Reconfirm the child entity using the current Mon connection')
    const value = JSON.parse(String(row.binding_json)) as ModelBinding
    return { entityId: actorIdSchema.parse(value.entityId), label: String(value.label), model: configuredModelSchema.parse(value.model) }
  }
  remove(sessionId: string, key: string, revision: string) {
    this.connectionHash(sessionId)
    if (!this.database.connection.prepare('DELETE FROM mon_child_models WHERE session_id=? AND model_key=? AND revision=?').run(sessionId, key, revision).changes) throw new Error('Child model profile changed; reload')
    return { key }
  }
}

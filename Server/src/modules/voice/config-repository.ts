import type { EdenDatabase } from '@eden/store'
import { gsvTtsConfigSchema, gsvSttConfigSchema } from '@eden/api'
export class VoiceConfigRepository {
  constructor(private readonly database: EdenDatabase) {}
  read() {
    const rows = this.database.connection.prepare('SELECT kind,config_json FROM voice_configuration').all()
    const values = Object.fromEntries(rows.map(row => [String(row.kind), JSON.parse(String(row.config_json))]))
    return { tts: gsvTtsConfigSchema.parse(values.tts ?? {}), stt: gsvSttConfigSchema.parse(values.stt ?? {}) }
  }
  update(kind: 'tts' | 'stt', raw: unknown) {
    const config = kind === 'tts' ? gsvTtsConfigSchema.parse(raw) : gsvSttConfigSchema.parse(raw)
    if (kind === 'tts' && 'roleId' in config && !config.roleId && !config.role) throw new Error('Choose a GSV voice role before saving')
    this.database.transaction(() => {
      this.database.connection.prepare('INSERT INTO voice_configuration VALUES(?,?,?) ON CONFLICT(kind) DO UPDATE SET config_json=excluded.config_json,updated_at=excluded.updated_at')
        .run(kind, JSON.stringify(config), Date.now())
      this.database.connection.prepare("UPDATE legacy_app_config SET state='reconfigured',resolution_json=?,resolved_at=? WHERE target_key=? AND state='review_required'")
        .run(JSON.stringify(config), Date.now(), `voice_configuration.${kind}`)
    })
    return this.read()
  }
}

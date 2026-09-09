import type { DatabaseSync } from 'node:sqlite'
import { commandExecutionConfigSchema, gsvSttConfigSchema, gsvTtsConfigSchema, permissionModeSchema } from '@eden/api'
import type { LegacySnapshotReader } from './snapshot-reader.ts'
import { legacyText, legacyTime, legacyJson, preserveLegacyRow } from './fields.ts'
import { tableConverted } from './conversion-state.ts'
interface Outcome { state: string; target: string | null; error: string | null }
function convertSetting(db: DatabaseSync, key: string, value: unknown, time: number, origin: string): Outcome {
  if (key === 'system.runtime_origin') {
    if (value !== origin) throw new Error('Historical configuration world differs from snapshot world')
    return { state: 'applied', target: 'realm_meta.origin', error: null }
  }
  if (key === 'voice.gsv.tts' || key === 'voice.gsv.stt') {
    const kind = key === 'voice.gsv.tts' ? 'tts' : 'stt'
    const parsed = (kind === 'tts' ? gsvTtsConfigSchema : gsvSttConfigSchema).safeParse(value)
    if (!parsed.success) return { state: 'review_required', target: `voice_configuration.${kind}`, error: 'Historical voice settings do not satisfy the current configuration contract' }
    db.prepare('INSERT INTO voice_configuration VALUES(?,?,?)').run(kind, JSON.stringify(parsed.data), time)
    return { state: 'applied', target: `voice_configuration.${kind}`, error: null }
  }
  if (key === 'permission.mode' || key === 'legacy.permission.mode') {
    const parsed = permissionModeSchema.safeParse(value)
    if (!parsed.success) return { state: 'review_required', target: 'permission.mode', error: 'Unsupported historical permission mode' }
    if (key === 'permission.mode' && parsed.data === 'restricted') {
      db.prepare('INSERT INTO runtime_settings VALUES(?,?,?)').run(key, JSON.stringify(parsed.data), time)
      return { state: 'applied', target: key, error: null }
    }
    return { state: 'confirmation_required', target: 'permission.mode', error: null }
  }
  if (key === 'command.execution') {
    const parsed = commandExecutionConfigSchema.safeParse(value)
    if (!parsed.success) return { state: 'review_required', target: key, error: 'Unsupported historical command execution settings' }
    if (parsed.data.mode !== 'sandbox' || parsed.data.networkAccess || parsed.data.writableRoots.length) return { state: 'confirmation_required', target: key, error: null }
    db.prepare('INSERT INTO runtime_settings VALUES(?,?,?)').run(key, JSON.stringify(parsed.data), time)
    return { state: 'applied', target: key, error: null }
  }
  if (key.startsWith('self_awake.session.')) {
    if (origin !== 'mon' || typeof value !== 'string' || !db.prepare('SELECT 1 FROM sessions WHERE id=?').get(value)) throw new Error('Historical self-awake session setting has invalid ownership or target')
    const metadata = db.prepare("SELECT payload_json FROM events WHERE session_id=? AND kind='session.metadata.updated' ORDER BY seq DESC LIMIT 1").get(value)
    const environment = metadata ? JSON.parse(String(metadata.payload_json)).environment : null
    if (!environment || environment.selfAwakeUserId !== key.slice('self_awake.session.'.length)) throw new Error('Historical self-awake configuration user does not match session ownership')
    // The new bridge creates an independently owned session per wake; retain the old index as history.
    return { state: 'retained_history', target: null, error: null }
  }
  return { state: 'review_required', target: null, error: 'Configuration key has no migration adapter' }
}

export async function convertLegacyAppConfig(db: DatabaseSync, source: LegacySnapshotReader): Promise<void> {
  if (!source.manifest.tables.some(table => table.name === 'app_config') || tableConverted(db, 'app_config')) return
  db.exec('BEGIN IMMEDIATE')
  try {
    await source.scan('app_config', row => {
      const key = legacyText(row, 'key'), raw = legacyJson(row, 'value_json'), time = legacyTime(row.updated_at)
      if (!key || key.length > 4096 || key.includes('\0')) throw new Error('Invalid historical configuration key')
      const outcome = convertSetting(db, key, JSON.parse(raw), time, source.manifest.origin)
      db.prepare('INSERT INTO legacy_app_config(key,value_json,updated_at,state,target_key,error) VALUES(?,?,?,?,?,?)')
        .run(key, raw, time, outcome.state, outcome.target, outcome.error)
      db.prepare('INSERT INTO legacy_conversion_records VALUES(?,?,?)').run('app_config', key, preserveLegacyRow(row))
      if (outcome.state === 'applied') db.prepare('INSERT INTO legacy_conversion_ids VALUES(?,?,?)').run('app_config', key, outcome.target!)
    })
    db.prepare("UPDATE legacy_conversion_tables SET state='converted' WHERE name='app_config'").run()
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

import { permissionModeSchema, type PermissionMode } from '@eden/api'
import type { EdenDatabase } from '@eden/store'

/** Approval policy only. Execution isolation and package grants are independent. */
export class PermissionModeStore {
  constructor(private readonly database: EdenDatabase) {}

  read(): PermissionMode {
    const row = this.database.connection.prepare("SELECT value_json FROM runtime_settings WHERE key='permission.mode'").get()
    return row ? permissionModeSchema.parse(JSON.parse(String(row.value_json))) : 'restricted'
  }

  set(value: PermissionMode): PermissionMode {
    const mode = permissionModeSchema.parse(value)
    return this.database.transaction(() => {
      const previous = this.read()
      const now = Date.now()
      this.database.connection.prepare("UPDATE legacy_app_config SET state='reconfigured',resolution_json=?,resolved_at=? WHERE target_key='permission.mode' AND state IN ('confirmation_required','review_required')")
        .run(JSON.stringify(mode), now)
      if (previous === mode) return mode
      this.database.connection.prepare('INSERT OR REPLACE INTO runtime_settings VALUES (?, ?, ?)')
        .run('permission.mode', JSON.stringify(mode), now)
      this.database.connection.prepare('INSERT INTO runtime_setting_changes(key,previous_json,value_json,created_at) VALUES (?, ?, ?, ?)')
        .run('permission.mode', JSON.stringify(previous), JSON.stringify(mode), now)
      return mode
    })
  }

  allows(capability: string): boolean {
    const mode = this.read()
    const terminal = capability === 'command.execute' || capability.startsWith('shell.')
    return mode === 'takeover' || (mode === 'full_access' && !terminal)
  }
}

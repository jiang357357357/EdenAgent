import type { EdenDatabase } from '@eden/store'

export class WorkspaceRepository {
  constructor(private readonly database: EdenDatabase) {}

  read(): string | undefined {
    const row = this.database.connection.prepare("SELECT value_json FROM runtime_settings WHERE key='workspace.root'").get()
    if (!row) return undefined
    const value: unknown = JSON.parse(String(row.value_json))
    if (typeof value !== 'string') throw new Error('Invalid persisted workspace root')
    return value
  }

  set(root: string): void {
    this.database.connection.prepare('INSERT OR REPLACE INTO runtime_settings VALUES (?, ?, ?)').run('workspace.root', JSON.stringify(root), Date.now())
    this.database.connection.prepare("UPDATE runtime_settings SET value_json=json_set(value_json,'$.state','reselected'),updated_at=? WHERE key='workspace.legacy_import'").run(Date.now())
  }
}

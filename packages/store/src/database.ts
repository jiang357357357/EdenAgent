import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { migrateDatabase } from './migrations.ts'

export class EdenDatabase {
  readonly connection: DatabaseSync
  private activeTransaction = false

  constructor(filename: string, origin: 'mon' | 'local') {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 })
    this.connection = new DatabaseSync(filename)
    try {
      this.connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;')
      // Refuse legacy/foreign databases before migrations can change their schema.
      const tables = this.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
      if (tables.length && !tables.some(row => row.name === 'realm_meta')) throw new Error('Legacy or foreign database requires explicit import')
      if (tables.length) {
        this.assertOrigin(origin)
        const importing = this.connection.prepare("SELECT value FROM realm_meta WHERE key='legacy_import_state'").get()
        if (importing && importing.value !== 'complete') throw new Error('Legacy import is incomplete; finish conversion before starting the host')
      }
      this.connection.exec('PRAGMA journal_mode=WAL')
      migrateDatabase(this.connection)
      this.transaction(() => {
        this.connection.prepare("INSERT OR IGNORE INTO realm_meta VALUES ('origin', ?)").run(origin)
        this.assertOrigin(origin)
      })
      if (filename !== ':memory:' && process.platform !== 'win32') chmodSync(filename, 0o600)
    } catch (error) {
      this.connection.close()
      throw error
    }
  }

  private assertOrigin(origin: string): void {
    const bound = this.connection.prepare("SELECT value FROM realm_meta WHERE key='origin'").get()
    if (bound?.value !== origin) throw new Error('Database runtime origin mismatch')
  }

  transaction<T>(operation: () => T): T {
    if (this.activeTransaction) throw new Error('Nested transactions must use the owning repository transaction')
    this.connection.exec('BEGIN IMMEDIATE')
    this.activeTransaction = true
    try {
      const result = operation()
      if (result instanceof Promise) throw new Error('Database transactions must be synchronous')
      this.connection.exec('COMMIT')
      return result
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    } finally {
      this.activeTransaction = false
    }
  }

  get inTransaction(): boolean { return this.activeTransaction }

  close(): void { this.connection.close() }
}

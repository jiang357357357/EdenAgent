import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { migrateDatabase } from './migrations.ts'
import { assertStagingMutable, assertRuntimePublished } from './legacy/activation-guard.ts'
import { assertPublicationGroup } from './legacy/publication-group.ts'

export class EdenDatabase {
  readonly connection: DatabaseSync
  private activeTransaction = false

  constructor(filename: string, origin: 'mon' | 'local', mode: 'runtime' | 'migration-review' = 'runtime') {
    if (filename !== ':memory:') {
      if (mode === 'migration-review') assertStagingMutable(path.dirname(filename))
      else assertRuntimePublished(filename)
    }
    if (mode === 'migration-review') {
      const file = lstatSync(filename)
      if (!file.isFile() || file.isSymbolicLink()) throw new Error('Review requires an existing regular migration database')
    }
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 })
    this.connection = new DatabaseSync(filename)
    try {
      this.connection.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;')
      // Refuse legacy/foreign databases before migrations can change their schema.
      this.assertExistingDatabase(origin, mode, filename)
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

  private assertExistingDatabase(origin: 'mon' | 'local', mode: 'runtime' | 'migration-review', filename: string) {
    const tables = this.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
    if (tables.length && !tables.some(row => row.name === 'realm_meta')) throw new Error('Legacy or foreign database requires explicit import')
    if (tables.length) {
      this.assertOrigin(origin)
      const importing = this.connection.prepare("SELECT value FROM realm_meta WHERE key='legacy_import_state'").get()
      if (mode === 'migration-review' ? importing?.value !== 'incomplete' : importing && importing.value !== 'complete') throw new Error('Database import state does not permit this host mode')
      if (mode === 'runtime') assertPublicationGroup(this.connection, filename, origin)
    }
    if (mode === 'migration-review' && !tables.length) throw new Error('Review requires an initialized incomplete import')
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

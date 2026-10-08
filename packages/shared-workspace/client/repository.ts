import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Binding, Commit, Conflict, SharedFile } from './contracts.ts'

export class SyncRepository {
  readonly db: DatabaseSync
  constructor(root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path.join(root, 'sync.sqlite'))
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS shared_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bindings(id TEXT PRIMARY KEY,workspace_key TEXT UNIQUE NOT NULL,space_id TEXT NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0,cursor INTEGER NOT NULL DEFAULT 0,last_sync INTEGER);
      CREATE TABLE IF NOT EXISTS files(binding_id TEXT NOT NULL,file_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(binding_id,file_id));
      CREATE TABLE IF NOT EXISTS outbox(binding_id TEXT NOT NULL,file_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(binding_id,file_id));
      CREATE TABLE IF NOT EXISTS conflicts(id TEXT PRIMARY KEY,binding_id TEXT NOT NULL,file_id TEXT NOT NULL,value TEXT NOT NULL,
        UNIQUE(binding_id,file_id));`)
    const schema = this.db.prepare("SELECT value FROM shared_meta WHERE key='schema'").get()
    if (schema && schema.value !== '1') { this.db.close(); throw new Error('不支持的共享资料本地数据库版本') }
    this.db.prepare("INSERT OR IGNORE INTO shared_meta VALUES('schema','1')").run()
  }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = work(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  binding(key: string): Binding | null {
    const r = this.db.prepare('SELECT * FROM bindings WHERE workspace_key=?').get(key)
    return r ? { id: String(r.id), workspaceKey: String(r.workspace_key), spaceId: String(r.space_id), paused: Boolean(r.paused),
      cursor: Number(r.cursor), lastSync: r.last_sync === null ? null : Number(r.last_sync) } : null
  }
  bind(key: string, spaceId: string): Binding {
    const old = this.binding(key)
    if (old && old.spaceId !== spaceId) throw new Error('当前工作区已绑定其他资料库，请选择另一个工作区')
    if (!old) this.db.prepare('INSERT INTO bindings(id,workspace_key,space_id) VALUES(?,?,?)').run(randomUUID(), key, spaceId)
    return this.binding(key)!
  }
  pause(id: string, paused: boolean) { this.db.prepare('UPDATE bindings SET paused=? WHERE id=?').run(Number(paused), id) }
  cursor(id: string, cursor: number) { this.db.prepare('UPDATE bindings SET cursor=? WHERE id=?').run(cursor, id) }
  synced(id: string) { this.db.prepare('UPDATE bindings SET last_sync=? WHERE id=?').run(Date.now(), id) }
  files(id: string): SharedFile[] { return this.rows<SharedFile>('files', id) }
  pending(id: string): Commit[] { return this.rows<Commit>('outbox', id) }
  conflicts(id: string): Conflict[] { return this.rows<Conflict>('conflicts', id) }
  private rows<T>(table: 'files' | 'outbox' | 'conflicts', id: string): T[] {
    return this.db.prepare(`SELECT value FROM ${table} WHERE binding_id=? ORDER BY rowid`).all(id).map(r => JSON.parse(String(r.value)) as T)
  }
  file(id: string, file: SharedFile) {
    this.db.prepare('INSERT INTO files VALUES(?,?,?) ON CONFLICT(binding_id,file_id) DO UPDATE SET value=excluded.value')
      .run(id, file.fileId, JSON.stringify(file))
  }
  enqueue(id: string, item: Commit) {
    this.db.prepare('INSERT INTO outbox VALUES(?,?,?) ON CONFLICT(binding_id,file_id) DO NOTHING').run(id, item.fileId, JSON.stringify(item))
  }
  acknowledge(id: string, fileId: string) { this.db.prepare('DELETE FROM outbox WHERE binding_id=? AND file_id=?').run(id, fileId) }
  conflict(id: string, local: Commit, remote: SharedFile | null) {
    const previous = this.conflicts(id).find(c => c.local.fileId === local.fileId)
    const value: Conflict = { id: previous?.id ?? randomUUID(), path: local.path, local, remote, createdAt: previous?.createdAt ?? Date.now() }
    this.db.prepare('INSERT INTO conflicts VALUES(?,?,?,?) ON CONFLICT(binding_id,file_id) DO UPDATE SET value=excluded.value')
      .run(value.id, id, local.fileId, JSON.stringify(value))
    this.acknowledge(id, local.fileId)
  }
  removeConflict(id: string) { this.db.prepare('DELETE FROM conflicts WHERE id=?').run(id) }
  removeFile(binding: string, fileId: string) { this.db.prepare('DELETE FROM files WHERE binding_id=? AND file_id=?').run(binding, fileId) }
  close() { this.db.close() }
}

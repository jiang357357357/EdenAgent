import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SharedFile, Commit } from '../client/contracts.ts'
import { LanError, type Identity, type Peer, type Space, type Role, type Member } from './contracts.ts'
import { digest } from './identity.ts'

export class LanRepository {
  readonly db: DatabaseSync
  readonly device: Identity
  constructor(root: string, device: Identity) {
    this.device = device
    mkdirSync(root, { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path.join(root, 'lan.sqlite'))
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS lan_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS peers(id TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS libraries(id TEXT PRIMARY KEY,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS catalog(id TEXT PRIMARY KEY,peer_id TEXT NOT NULL,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members(space_id TEXT NOT NULL,device_id TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(space_id,device_id));
      CREATE TABLE IF NOT EXISTS blobs(space_id TEXT NOT NULL,sha TEXT NOT NULL,size INTEGER NOT NULL,PRIMARY KEY(space_id,sha));
      CREATE TABLE IF NOT EXISTS heads(space_id TEXT NOT NULL,file_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(space_id,file_id));
      CREATE TABLE IF NOT EXISTS versions(space_id TEXT NOT NULL,file_id TEXT NOT NULL,revision INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(space_id,file_id,revision));
      CREATE TABLE IF NOT EXISTS changes(sequence INTEGER PRIMARY KEY AUTOINCREMENT,space_id TEXT NOT NULL,value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS changes_space_sequence ON changes(space_id,sequence);
      CREATE TABLE IF NOT EXISTS operations(space_id TEXT NOT NULL,id TEXT NOT NULL,actor TEXT NOT NULL,fingerprint TEXT NOT NULL,status INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(space_id,id));`)
    const schema = this.db.prepare("SELECT value FROM lan_meta WHERE key='schema'").get()
    if (schema && schema.value !== '2') { this.db.close(); throw new Error('不支持的局域网资料库数据库版本') }
    this.db.prepare("INSERT OR IGNORE INTO lan_meta VALUES('schema','2')").run()
  }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = work(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  peers(): Peer[] { return this.db.prepare('SELECT value FROM peers').all().map(row => JSON.parse(String(row.value)) as Peer) }
  peer(id: string): Peer {
    const peer = this.peers().find(item => item.deviceId === id && !item.revoked)
    if (!peer) throw new LanError(403, '设备未配对或配对已撤销')
    return peer
  }
  savePeer(peer: Peer) {
    const existing = this.peers().find(item => item.deviceId === peer.deviceId)
    if (existing && existing.publicKey !== peer.publicKey) throw new LanError(403, '设备身份发生变化，请核对后重新配对')
    this.db.prepare('INSERT INTO peers VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(peer.deviceId, JSON.stringify(peer))
  }
  revoke(id: string) {
    if (id === this.device.deviceId) throw new LanError(400, '不能撤销本机设备')
    const peer = this.peer(id)
    this.transaction(() => {
      this.savePeer({ ...peer, revoked: true, key: '' })
      this.db.prepare('DELETE FROM members WHERE device_id=?').run(id)
      this.db.prepare('DELETE FROM catalog WHERE peer_id=?').run(id)
    })
  }
  ownSpaces(actor: string): Space[] {
    return this.db.prepare('SELECT id,name FROM libraries').all().flatMap(row => {
      const role = this.role(String(row.id), actor, false)
      return role ? [{ id: String(row.id), name: String(row.name), role, hostDeviceId: this.device.deviceId, hostName: this.device.name, reachable: true }] : []
    })
  }
  create(name: string): Space {
    const id = randomUUID()
    this.db.prepare('INSERT INTO libraries VALUES(?,?)').run(id, name)
    return { id, name, role: 'owner', hostDeviceId: this.device.deviceId, hostName: this.device.name, reachable: true }
  }
  role(spaceId: string, actor: string, required = true): Role | null {
    const own = this.db.prepare('SELECT id FROM libraries WHERE id=?').get(spaceId)
    let role: Role | null = null
    if (own && actor === this.device.deviceId) role = 'owner'
    else if (own) {
      const peer = this.peers().find(item => item.deviceId === actor && !item.revoked)
      if (peer) { const row = this.db.prepare('SELECT role FROM members WHERE space_id=? AND device_id=?').get(spaceId, actor); role = row ? row.role as Role : null }
    }
    if (!role && required) throw new LanError(403, '该设备没有此资料库的访问权限')
    return role
  }
  requireWrite(spaceId: string, actor: string) {
    if (this.role(spaceId, actor) === 'viewer') throw new LanError(403, '只读设备不能上传或恢复文件')
  }
  members(spaceId: string, actor: string): Member[] {
    this.role(spaceId, actor)
    return [{ deviceId: this.device.deviceId, name: this.device.name, role: 'owner' },
      ...this.db.prepare('SELECT device_id,role FROM members WHERE space_id=?').all(spaceId).map(row => ({
        deviceId: String(row.device_id), name: this.peer(String(row.device_id)).name, role: row.role as Role }))]
  }
  setMember(spaceId: string, actor: string, id: string, role: 'editor' | 'viewer' | null) {
    if (this.role(spaceId, actor) !== 'owner') throw new LanError(403, '仅发布此资料库的设备能设置共享权限')
    if (id === this.device.deviceId) throw new LanError(400, '不能更改发布设备的权限')
    this.peer(id)
    if (role) this.db.prepare('INSERT INTO members VALUES(?,?,?) ON CONFLICT(space_id,device_id) DO UPDATE SET role=excluded.role').run(spaceId, id, role)
    else this.db.prepare('DELETE FROM members WHERE space_id=? AND device_id=?').run(spaceId, id)
  }
  cache(peer: Peer, spaces: Space[]) {
    this.transaction(() => {
      for (const space of spaces) {
        const prior = this.host(space.id)
        if (prior && prior !== peer.deviceId) throw new LanError(409, '资料库标识与其他发布设备冲突')
      }
      this.db.prepare('DELETE FROM catalog WHERE peer_id=?').run(peer.deviceId)
      for (const space of spaces) this.db.prepare('INSERT INTO catalog VALUES(?,?,?)').run(space.id, peer.deviceId, JSON.stringify(space))
    })
  }
  cached(): Space[] { return this.db.prepare('SELECT value FROM catalog').all().map(row => JSON.parse(String(row.value)) as Space) }
  host(id: string): string | null {
    if (this.db.prepare('SELECT id FROM libraries WHERE id=?').get(id)) return this.device.deviceId
    const row = this.db.prepare('SELECT peer_id FROM catalog WHERE id=?').get(id)
    return row ? String(row.peer_id) : null
  }
  blob(spaceId: string, sha: string): number | null {
    const row = this.db.prepare('SELECT size FROM blobs WHERE space_id=? AND sha=?').get(spaceId, sha)
    return row ? Number(row.size) : null
  }
  saveBlob(spaceId: string, actor: string, sha: string, size: number) {
    this.requireWrite(spaceId, actor)
    this.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(spaceId, sha, size)
  }
  files(spaceId: string): SharedFile[] { return this.db.prepare('SELECT value FROM heads WHERE space_id=?').all(spaceId).map(row => JSON.parse(String(row.value)) as SharedFile) }
  history(spaceId: string, fileId: string): SharedFile[] {
    return this.db.prepare('SELECT value FROM versions WHERE space_id=? AND file_id=? ORDER BY revision DESC').all(spaceId, fileId).map(row => JSON.parse(String(row.value)) as SharedFile)
  }
  changes(spaceId: string, after: number, limit: number) {
    const rows = this.db.prepare('SELECT sequence,value FROM changes WHERE space_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(spaceId, after, limit + 1)
    const changes = rows.slice(0, limit).map(row => ({ sequence: Number(row.sequence), file: JSON.parse(String(row.value)) as SharedFile }))
    return { changes, cursor: changes.at(-1)?.sequence ?? after, hasMore: rows.length > limit }
  }
  commit(spaceId: string, actor: string, item: Commit): { status: number; body: unknown } {
    return this.transaction(() => {
      this.requireWrite(spaceId, actor)
      const fingerprint = digest(JSON.stringify(item)), prior = this.db.prepare('SELECT * FROM operations WHERE space_id=? AND id=?').get(spaceId, item.operationId)
      if (prior) {
        if (prior.actor !== actor || prior.fingerprint !== fingerprint) throw new LanError(400, '提交标识被不同请求重复使用')
        return { status: Number(prior.status), body: JSON.parse(String(prior.value)) }
      }
      const files = this.files(spaceId), current = files.find(file => file.fileId === item.fileId)
      const key = item.path.toLocaleLowerCase('en-US')
      const other = item.deleted ? undefined : files.find(file => file.fileId !== item.fileId && !file.deleted &&
        (file.path.toLocaleLowerCase('en-US') === key || file.path.toLocaleLowerCase('en-US').startsWith(`${key}/`) || key.startsWith(`${file.path.toLocaleLowerCase('en-US')}/`)))
      if ((current?.revision ?? 0) !== item.baseRevision || other) return this.remember(spaceId, actor, item, fingerprint, 409, { error: 'conflict', current: current ?? other ?? null })
      if (!item.deleted && this.blob(spaceId, item.sha256!) !== item.size) throw new LanError(400, '提交内容尚未上传或大小不一致')
      const file = { fileId: item.fileId, path: item.path, revision: (current?.revision ?? 0) + 1, deleted: item.deleted, sha256: item.sha256, size: item.size }
      this.db.prepare('INSERT INTO heads VALUES(?,?,?) ON CONFLICT(space_id,file_id) DO UPDATE SET value=excluded.value').run(spaceId, item.fileId, JSON.stringify(file))
      this.db.prepare('INSERT INTO versions VALUES(?,?,?,?)').run(spaceId, item.fileId, file.revision, JSON.stringify(file))
      const result = this.db.prepare('INSERT INTO changes(space_id,value) VALUES(?,?)').run(spaceId, JSON.stringify(file))
      return this.remember(spaceId, actor, item, fingerprint, 200, { file, sequence: Number(result.lastInsertRowid) })
    })
  }
  private remember(spaceId: string, actor: string, item: Commit, fingerprint: string, status: number, body: unknown) {
    this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?)').run(spaceId, item.operationId, actor, fingerprint, status, JSON.stringify(body))
    return { status, body }
  }
  close() { this.db.close() }
}

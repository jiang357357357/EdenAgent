import { createHash, randomUUID } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import type { MarketSource, MarketPayload } from './contracts.ts'
export class MarketRepository {
  constructor(private readonly database: EdenDatabase) {}
  keys() { return this.database.connection.prepare('SELECT * FROM plugin_market_keys ORDER BY id').all().map(row => ({ id: String(row.id), publicKey: String(row.public_key), enabled: Boolean(row.enabled), fingerprint: createHash('sha256').update(Buffer.from(String(row.public_key), 'base64')).digest('hex') })) }
  addKey(id: string, publicKey: string) {
    if (Buffer.from(publicKey, 'base64').length !== 32) throw new Error('Public key must contain 32 bytes')
    const old = this.database.connection.prepare('SELECT public_key FROM plugin_market_keys WHERE id=?').get(id)
    if (old && old.public_key !== publicKey) throw new Error('Key ID already belongs to a different public key; use a new ID')
    this.database.connection.prepare('INSERT INTO plugin_market_keys VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET enabled=1').run(id, publicKey)
    return this.keys().find(key => key.id === id)!
  }
  revokeKey(id: string) {
    return this.database.transaction(() => {
      const result = this.database.connection.prepare('UPDATE plugin_market_keys SET enabled=0 WHERE id=?').run(id)
      this.database.connection.prepare("UPDATE plugin_market_sources SET payload_json=NULL,index_revision=NULL,epoch=?,last_error='Signing key revoked' WHERE key_id=?").run(randomUUID(), id)
      return { revoked: Number(result.changes) > 0 }
    })
  }
  key(id: string): string {
    const row = this.database.connection.prepare('SELECT public_key FROM plugin_market_keys WHERE id=? AND enabled=1').get(id)
    if (!row) throw new Error('Market signing key is not trusted')
    return String(row.public_key)
  }
  list() { return this.database.connection.prepare('SELECT id FROM plugin_market_sources ORDER BY id').all().map(row => this.read(String(row.id))) }
  read(id: string) {
    const row = this.raw(id)
    return { id, name: String(row.name), url: String(row.url), keyID: String(row.key_id), enabled: Boolean(row.enabled), indexRevision: row.index_revision,
      lastRefreshedAt: row.refreshed_at, lastError: row.last_error }
  }
  raw(id: string) {
    const row = this.database.connection.prepare('SELECT * FROM plugin_market_sources WHERE id=?').get(id)
    if (!row) throw new Error('Market source not found')
    return row
  }
  add(input: MarketSource) {
    this.key(input.keyID)
    this.database.connection.prepare(`INSERT INTO plugin_market_sources(id,name,url,key_id,enabled,epoch) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,key_id=excluded.key_id,enabled=excluded.enabled,epoch=excluded.epoch,
      payload_json=NULL,index_revision=NULL,refreshed_at=NULL,last_error=NULL`).run(input.id, input.name, input.url, input.keyID, Number(input.enabled), randomUUID())
    return this.read(input.id)
  }
  remove(id: string) { return { deleted: Number(this.database.connection.prepare('DELETE FROM plugin_market_sources WHERE id=?').run(id).changes) > 0 } }
  save(id: string, epoch: string, payload: MarketPayload, revision: string) {
    this.database.transaction(() => {
      const old = this.raw(id)
      this.key(String(old.key_id))
      if (old.epoch !== epoch || !old.enabled) throw new Error('Market source changed during refresh')
      const previous = old.payload_json ? JSON.parse(String(old.payload_json)) as MarketPayload : null
      if (previous && (payload.generatedAt < previous.generatedAt || (payload.generatedAt === previous.generatedAt && revision !== old.index_revision))) throw new Error('Market index rollback or conflicting generation refused')
      this.database.connection.prepare('UPDATE plugin_market_sources SET payload_json=?,index_revision=?,refreshed_at=?,last_error=NULL WHERE id=?').run(JSON.stringify(payload), revision, Date.now(), id)
    })
    return this.read(id)
  }
  failure(id: string, epoch: string) { this.database.connection.prepare("UPDATE plugin_market_sources SET last_error='Index refresh failed; source or signature could not be verified' WHERE id=? AND epoch=?").run(id, epoch) }
  historicalRevocation(pluginId: string, version: string, revision: string): string | null {
    const row = this.database.connection.prepare('SELECT reason FROM legacy_plugin_revocations WHERE plugin_id=? AND version=? AND revision=? ORDER BY revoked_at DESC LIMIT 1')
      .get(pluginId, version, revision)
    return row ? String(row.reason) : null
  }
  assertNotHistoricallyRevoked(pluginId: string, version: string, revision: string): void {
    if (this.historicalRevocation(pluginId, version, revision) !== null) throw new Error('This plugin release was revoked before migration')
  }
  release(sourceId: string, pluginId: string, version: string) {
    const source = this.raw(sourceId)
    this.key(String(source.key_id))
    if (!source.enabled || !source.payload_json) throw new Error('Market source has no enabled verified index')
    const payload: MarketPayload = JSON.parse(String(source.payload_json))
    if (payload.expiresAt <= Date.now()) throw new Error('Market index expired; refresh before downloading')
    const release = payload.plugins.find(plugin => plugin.id === pluginId)?.versions.find(item => item.version === version)
    if (!release) throw new Error('Market release not found')
    this.assertNotHistoricallyRevoked(pluginId, version, release.revision)
    if (payload.revocations.some(item => item.pluginId === pluginId && item.version === version && item.revision === release.revision)) throw new Error('Market release has been revoked')
    return { ...release, epoch: String(source.epoch), indexRevision: String(source.index_revision) }
  }
  releases(sourceID?: string) {
    const sources = sourceID ? [this.raw(sourceID)] : this.list().map(source => this.raw(source.id))
    return sources.flatMap(source => {
      if (!source.enabled || !source.payload_json) return []
      this.key(String(source.key_id))
      const payload: MarketPayload = JSON.parse(String(source.payload_json))
      if (payload.expiresAt <= Date.now()) return []
      return payload.plugins.flatMap(plugin => plugin.versions.map(release => {
        const revoked = payload.revocations.find(item => item.pluginId === plugin.id && item.version === release.version && item.revision === release.revision)
        const historicalReason = this.historicalRevocation(plugin.id, release.version, release.revision)
        return { sourceID: String(source.id), pluginID: plugin.id, name: plugin.name, description: plugin.description, version: release.version,
          revision: release.revision, revoked: Boolean(revoked) || historicalReason !== null, revocationReason: revoked?.reason ?? historicalReason }
      }))
    })
  }
}

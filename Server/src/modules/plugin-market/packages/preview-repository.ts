import { assertPackageHostVersion } from './host-version.ts'
import { randomUUID } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import { packageManifest, componentSummary } from './manifest.ts'
import { verifyPackageFiles } from './integrity.ts'
import type { downloadMarketPackage } from './download.ts'
import type { MarketRepository } from '../repository.ts'
type Download = Omit<Awaited<ReturnType<typeof downloadMarketPackage>>, 'provenance'> & { provenance: Awaited<ReturnType<typeof downloadMarketPackage>>['provenance'] & { sourceType?: 'local'; sourceUri?: string } }
export class PackagePreviewRepository {
  constructor(private readonly database: EdenDatabase, private readonly market: MarketRepository) {}
  save(download: Download) {
    const manifest = packageManifest(download.manifest, download.snapshot)
    assertPackageHostVersion(manifest.minHostVersion, manifest.maxHostVersion)
    const id = randomUUID(), expires = Date.now() + 15 * 60000
    this.database.transaction(() => {
      this.database.connection.prepare('DELETE FROM plugin_package_previews WHERE expires_at<?').run(Date.now())
      const count = Number(this.database.connection.prepare('SELECT COUNT(*) AS count FROM plugin_package_previews').get()?.count)
      if (count >= 4) throw new Error('Plugin preview capacity reached; finish or discard existing previews')
      this.database.connection.prepare('INSERT INTO plugin_package_previews VALUES(?,?,?,?,?,?)').run(id,
        JSON.stringify(Object.fromEntries([...download.snapshot].map(([name, bytes]) => [name, bytes.toString('base64')]))),
        JSON.stringify(download.provenance), download.revision, download.keyId, expires)
    })
    return { previewID: id, id: manifest.id, name: manifest.name, description: manifest.description, version: manifest.version,
      revision: download.revision, verified: Boolean(download.keyId), sourceType: download.provenance.sourceType ?? 'marketplace', sourceUri: download.provenance.sourceUri ?? `market:${download.provenance.sourceId}/${manifest.id}@${manifest.version}#${download.revision}`,
      components: componentSummary(manifest), permissions: manifest.permissions, expiresAt: expires }
  }
  read(id: string) {
    const row = this.database.connection.prepare('SELECT * FROM plugin_package_previews WHERE id=?').get(id)
    if (!row || Number(row.expires_at) <= Date.now()) throw new Error('Plugin preview has expired; inspect again')
    const provenance: Download['provenance'] = JSON.parse(String(row.provenance_json))
    if (provenance.sourceType !== 'local') {
    const current = this.market.release(provenance.sourceId, provenance.pluginId, provenance.version)
    if (current.epoch !== provenance.epoch || current.revision !== provenance.revision || current.sha256 !== provenance.sha256) throw new Error('Market release changed since preview')
    }
    const encoded: Record<string, string> = JSON.parse(String(row.files_json))
    const files = new Map(Object.entries(encoded).map(([name, bytes]) => [name, Buffer.from(bytes, 'base64')]))
    const verified = verifyPackageFiles(files, keyId => this.market.key(keyId), provenance.sourceType === 'local' && row.key_id === '')
    if (verified.revision !== row.revision || verified.keyId !== row.key_id) throw new Error('Preview integrity differs from stored revision')
    return { previewID: id, manifest: packageManifest(verified.manifest, files), files, revision: verified.revision, keyId: verified.keyId, provenance }
  }
  discard(id: string) { return { deleted: Number(this.database.connection.prepare('DELETE FROM plugin_package_previews WHERE id=?').run(id).changes) > 0 } }
}

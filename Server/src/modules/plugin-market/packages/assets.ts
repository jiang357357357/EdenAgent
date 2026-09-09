import { packageAssetFiles } from './asset-files.ts'
import { createHash } from 'node:crypto'
import type { InstalledPackageRepository } from './installed-repository.ts'
import type { BlobService } from '../../blobs/index.ts'
export class PackageAssets {
  private closed = false
  private readonly pending = new Set<Promise<unknown>>()
  constructor(private readonly packages: InstalledPackageRepository, private readonly blobs: BlobService) {}
  list(id: string, revision: string) {
    const value = this.packages.verified(id, revision)
    return packageAssetFiles(value.manifest.assets, value.files).map(asset => {
      const bytes = value.files.get(asset.source)
      if (!bytes) throw new Error('Declared plugin asset is missing')
      return { ...asset, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    })
  }
  export(id: string, revision: string, source: string) {
    if (this.closed) throw new Error('Plugin asset service is shutting down')
    if (this.pending.size >= 2) throw new Error('Plugin asset export concurrency limit reached')
    const value = this.packages.verified(id, revision)
    const asset = packageAssetFiles(value.manifest.assets, value.files).find(item => item.source === source)
    if (!asset) throw new Error('Requested file is not a declared plugin asset')
    const bytes = value.files.get(source)
    if (!bytes) throw new Error('Declared plugin asset is missing')
    const task = this.blobs.put(bytes, 'application/octet-stream').then(blob => ({ source, targetKind: asset.targetKind, target: asset.target, blob }))
    this.pending.add(task)
    void task.finally(() => this.pending.delete(task)).catch(() => {})
    return task
  }
  async close() { this.closed = true; await Promise.allSettled([...this.pending]) }
}

import type { PackageRecoveryRepository } from './packages/recovery-repository.ts'
import { localPackageFiles } from './packages/local.ts'
import { verifyPackageFiles } from './packages/integrity.ts'
import type { InstalledPackageRepository } from './packages/installed-repository.ts'
import { downloadMarketPackage } from './packages/download.ts'
import type { PackagePreviewRepository } from './packages/preview-repository.ts'
import { MarketRepository } from './repository.ts'
import { verifyIndex } from './signature.ts'
export class MarketService {
  private readonly abort = new AbortController()
  private readonly pending = new Map<string, Promise<ReturnType<MarketRepository['read']>>>()
  private readonly downloads = new Set<Promise<unknown>>()
  constructor(readonly repository: MarketRepository, readonly previews: PackagePreviewRepository, readonly installed: InstalledPackageRepository, readonly recovery?: PackageRecoveryRepository) {}
  async inspectRecovered(sourceId: string) {
    if (!this.recovery) throw new Error('Plugin recovery is unavailable')
    const expected = await this.recovery.source(sourceId)
    return this.inspectLocal(expected.path, expected)
  }
  inspectLocal(source: string, expected?: Awaited<ReturnType<PackageRecoveryRepository['source']>>) {
    this.abort.signal.throwIfAborted()
    if (this.downloads.size >= 2) throw new Error('Plugin preview concurrency limit reached')
    const task = localPackageFiles(source, this.abort.signal, Boolean(expected)).then(({ root, files }) => {
      this.abort.signal.throwIfAborted()
      if (expected) this.recovery!.verifyFiles(expected, files)
      const verified = verifyPackageFiles(files, id => this.repository.key(id), true)
      if (expected && (verified.manifest.id !== expected.pluginId || verified.manifest.version !== expected.version || verified.revision !== expected.revision)) throw new Error('Recovered plugin identity or revision differs from the historical version')
      this.repository.assertNotHistoricallyRevoked(String(verified.manifest.id), String(verified.manifest.version), verified.revision)
      return this.previews.save({ ...verified, snapshot: files, provenance: { sourceType: 'local', sourceUri: root,
        sourceId: '', pluginId: String(verified.manifest.id), version: String(verified.manifest.version), revision: verified.revision, sha256: '', epoch: '' } })
    })
    this.downloads.add(task)
    void task.finally(() => this.downloads.delete(task)).catch(() => {})
    return task
  }
  inspect(sourceId: string, pluginId: string, version: string) {
    this.abort.signal.throwIfAborted()
    if (this.downloads.size >= 2) throw new Error('Two plugin downloads are already in progress')
    const task = downloadMarketPackage(this.repository, sourceId, pluginId, version, this.abort.signal).then(download => {
      this.abort.signal.throwIfAborted()
      return this.previews.save(download)
    })
    this.downloads.add(task)
    void task.finally(() => this.downloads.delete(task)).catch(() => {})
    return task
  }
  refresh(id: string) {
    this.abort.signal.throwIfAborted()
    const pending = this.pending.get(id)
    if (pending) return pending
    if (this.pending.size >= 4) throw new Error('Market refresh concurrency limit reached')
    const task = this.fetchIndex(id)
    this.pending.set(id, task)
    void task.finally(() => this.pending.delete(id)).catch(() => {})
    return task
  }
  async close() { this.abort.abort(); await Promise.allSettled([...this.pending.values(), ...this.downloads]) }
  private async fetchIndex(id: string) {
    const source = this.repository.raw(id), epoch = String(source.epoch)
    try {
      if (!source.enabled) throw new Error('Market source is disabled')
      const key = this.repository.key(String(source.key_id))
      const response = await fetch(String(source.url), { redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(45000)]), headers: { Accept: 'application/json' } })
      if (!response.ok || Number(response.headers.get('content-length')) > 4 * 1024 * 1024 || !response.body) { await response.body?.cancel(); throw new Error('Market index response is unavailable or too large') }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length
          if (size > 4 * 1024 * 1024) throw new Error('Market index exceeds 4 MiB')
          chunks.push(chunk.value)
        }
      } finally { await reader.cancel(); reader.releaseLock() }
      const verified = verifyIndex(JSON.parse(Buffer.concat(chunks).toString('utf8')), String(source.key_id), key)
      this.abort.signal.throwIfAborted()
      return this.repository.save(id, epoch, verified.payload, verified.revision)
    } catch (error) { this.repository.failure(id, epoch); throw error }
  }
}

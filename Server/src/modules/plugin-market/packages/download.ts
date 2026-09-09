import { createHash } from 'node:crypto'
import { readPackageZip } from './zip.ts'
import { verifyPackageFiles } from './integrity.ts'
import type { MarketRepository } from '../repository.ts'
export async function downloadMarketPackage(repository: MarketRepository, sourceId: string, pluginId: string, version: string, signal: AbortSignal) {
  const release = repository.release(sourceId, pluginId, version)
  const response = await fetch(release.url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]) })
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 72 * 1024 * 1024) {
    await response.body?.cancel(); throw new Error('Plugin package download unavailable or exceeds size limit')
  }
  const chunks: Uint8Array[] = [], reader = response.body.getReader()
  let size = 0
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break
      size += chunk.value.length
      if (size > 72 * 1024 * 1024) throw new Error('Plugin package exceeds 72 MiB')
      chunks.push(chunk.value)
    }
  } finally { await reader.cancel(); reader.releaseLock() }
  signal.throwIfAborted()
  const archive = Buffer.concat(chunks)
  if (createHash('sha256').update(archive).digest('hex') !== release.sha256) throw new Error('Downloaded package differs from signed market digest')
  const files = readPackageZip(archive)
  const verified = verifyPackageFiles(files, keyId => repository.key(keyId))
  if (verified.revision !== release.revision || verified.manifest?.id !== pluginId || verified.manifest?.version !== version) throw new Error('Package identity or revision differs from signed market release')
  const current = repository.release(sourceId, pluginId, version)
  if (JSON.stringify(current) !== JSON.stringify(release)) throw new Error('Market source or release changed while downloading')
  return { ...verified, snapshot: files, provenance: { sourceId, pluginId, version, revision: release.revision, sha256: release.sha256, epoch: release.epoch } }
}

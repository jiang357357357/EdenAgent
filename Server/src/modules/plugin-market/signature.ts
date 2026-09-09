import { createHash, createPublicKey, verify } from 'node:crypto'
import { envelopeSchema } from './contracts.ts'
export function verifyIndex(raw: unknown, expectedKey: string, publicKey: string) {
  const envelope = envelopeSchema.parse(raw), now = Date.now(), payload = envelope.payload
  if (envelope.keyId !== expectedKey) throw new Error('Market signing key differs from configured source')
  if (payload.generatedAt > now + 300000 || payload.expiresAt <= now || payload.expiresAt <= payload.generatedAt) throw new Error('Market index has expired or invalid validity dates')
  const ids = new Set<string>()
  for (const plugin of payload.plugins) {
    if (ids.has(plugin.id)) throw new Error('Duplicate plugin ID in market index')
    ids.add(plugin.id)
    const versions = new Set<string>()
    for (const release of plugin.versions) { if (versions.has(release.version)) throw new Error('Duplicate release version in market index'); versions.add(release.version) }
  }
  // Explicit field order matches the original serde struct serialization, independent of wire JSON order.
  const canonical = { generatedAt: payload.generatedAt, expiresAt: payload.expiresAt,
    plugins: payload.plugins.map(plugin => ({ id: plugin.id, name: plugin.name, description: plugin.description,
      versions: plugin.versions.map(release => ({ version: release.version, revision: release.revision, url: release.url, sha256: release.sha256 })) })),
    revocations: payload.revocations.map(item => ({ pluginId: item.pluginId, version: item.version, revision: item.revision, reason: item.reason })) }
  const bytes = Buffer.from(JSON.stringify(canonical))
  const key = Buffer.from(publicKey, 'base64'), signature = Buffer.from(envelope.signature, 'base64')
  if (key.length !== 32 || signature.length !== 64) throw new Error('Invalid Ed25519 key or signature length')
  const spki = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]), format: 'der', type: 'spki' })
  if (!verify(null, bytes, spki, signature)) throw new Error('Market signature does not match trusted key')
  return { payload, revision: createHash('sha256').update(bytes).digest('hex') }
}

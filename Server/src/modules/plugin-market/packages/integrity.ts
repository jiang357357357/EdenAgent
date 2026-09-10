import { createHash, createPublicKey, verify } from 'node:crypto'
import { z } from 'zod'
const signatureSchema = z.object({ keyId: z.string().min(1).max(128), algorithm: z.literal('ed25519'), signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict()
export function verifyPackageFiles(files: Map<string, Buffer>, trustedKey: (id: string) => string, allowUnsigned = false) {
  const { checksums, manifestBytes, signatureBytes } = packageMetadata(files, allowUnsigned)
  const contentNames = [...files.keys()].filter(name => name !== 'checksums.json' && name !== 'signature.json').sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
  if ((checksums && Object.keys(checksums).length !== contentNames.length) || !contentNames.length) throw new Error('Plugin checksum file set differs from archive')
  const digest = packageContentDigest(contentNames, checksums, files)
  const summary = { revision: createHash('sha256').update(manifestBytes).update(digest).digest('hex'), manifest: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)), files: contentNames, totalBytes: contentNames.reduce((sum, name) => sum + files.get(name)!.length, 0) }
  if (!signatureBytes && allowUnsigned) return { ...summary, keyId: '' }
  const signature = signatureSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(signatureBytes!)))
  const key = Buffer.from(trustedKey(signature.keyId), 'base64')
  if (key.length !== 32) throw new Error('Invalid trusted public key')
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]), format: 'der', type: 'spki' })
  if (!verify(null, Buffer.from(digest), publicKey, Buffer.from(signature.signature, 'base64'))) throw new Error('Plugin package signature is invalid')
  return {
    revision: createHash('sha256').update(manifestBytes).update(digest).digest('hex'), keyId: signature.keyId,
    manifest: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)), files: contentNames, totalBytes: contentNames.reduce((sum, name) => sum + files.get(name)!.length, 0)
  }
}

function packageMetadata(files: Map<string, Buffer<ArrayBufferLike>>, allowUnsigned: boolean) {
  const checksumsBytes = files.get('checksums.json'), signatureBytes = files.get('signature.json'), manifestBytes = files.get('plugin.json')
  if (!manifestBytes || (!allowUnsigned && (!checksumsBytes || !signatureBytes))) throw new Error('Signed plugin requires manifest, checksums and signature')
  if ((checksumsBytes?.length ?? 0) > 262144 || (signatureBytes?.length ?? 0) > 4096 || manifestBytes.length > 262144) throw new Error('Plugin metadata exceeds size limit')
  const checksums = checksumsBytes ? z.record(z.string(), z.string().regex(/^[a-fA-F0-9]{64}$/)).parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(checksumsBytes))) : null
  return { checksums, manifestBytes, signatureBytes }
}

function packageContentDigest(contentNames: string[], checksums: Record<string, string> | null, files: Map<string, Buffer<ArrayBufferLike>>) {
  const aggregate = createHash('sha256')
  for (const name of contentNames) {
    if (checksums && !Object.hasOwn(checksums, name)) throw new Error('Plugin contains an undeclared file')
    const actual = createHash('sha256').update(files.get(name)!).digest('hex')
    if (checksums && actual !== checksums[name]!.toLowerCase()) throw new Error(`Plugin checksum mismatch: ${name}`)
    aggregate.update(name).update(actual)
  }
  const digest = aggregate.digest('hex')
  return digest
}

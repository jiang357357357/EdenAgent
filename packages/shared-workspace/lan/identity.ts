import { generateKeyPairSync, randomUUID, createPrivateKey, createPublicKey, sign, verify, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { hostname } from 'node:os'
import type { Identity } from './contracts.ts'
import { binary, publicKey, record, text, uuid } from './validation.ts'

export function identity(root: string, name?: string): Identity {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const filename = path.join(root, 'device.json')
  try {
    const value = record(JSON.parse(readFileSync(filename, 'utf8')))
    const result = { deviceId: uuid(value.deviceId), name: text(value.name), publicKey: publicKey(value.publicKey), privateKey: text(value.privateKey, 200) }
    const derived = createPublicKey(createPrivateKey({ key: binary(result.privateKey), format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' }).toString('base64url')
    if (derived !== result.publicKey) throw new Error('局域网设备身份损坏，停止共享以保护配对关系')
    return result
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const keys = generateKeyPairSync('ed25519')
  const result = { deviceId: randomUUID(), name: text(name || hostname()),
    publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url') }
  const temp = `${filename}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(result), { mode: 0o600, flag: 'wx' }); renameSync(temp, filename)
  return result
}
export function signature(value: string, device: Identity): string {
  return sign(null, Buffer.from(value), { key: binary(device.privateKey), format: 'der', type: 'pkcs8' }).toString('base64url')
}
export function verified(value: string, key: string, signed: unknown): boolean {
  try { return verify(null, Buffer.from(value), { key: binary(publicKey(key)), format: 'der', type: 'spki' }, binary(signed, 64)) }
  catch { return false }
}
export function digest(value: Uint8Array | string): string { return createHash('sha256').update(value).digest('hex') }

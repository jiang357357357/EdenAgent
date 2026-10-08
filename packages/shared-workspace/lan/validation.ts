import { isIP } from 'node:net'
import { createPublicKey } from 'node:crypto'
import { safeRelative } from '../client/paths.ts'
import { MAX_FILE_BYTES } from '../client/contracts.ts'
import { LanError, type ValidCommit } from './contracts.ts'

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LanError(400, '无效局域网请求')
  return value as Record<string, unknown>
}
export function text(value: unknown, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new LanError(400, '无效文本字段')
  return value.trim()
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)) throw new LanError(400, '无效设备或资料库 ID')
  return value
}
export function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new LanError(400, '无效内容校验和')
  return value
}
export function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new LanError(400, '无效整数')
  return value
}
export function binary(value: unknown, length?: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) throw new LanError(400, '无效编码')
  const bytes = Buffer.from(value, 'base64url')
  if ((length !== undefined && bytes.length !== length) || bytes.toString('base64url') !== value) throw new LanError(400, '无效编码长度')
  return bytes
}
export function publicKey(value: unknown, type: 'ed25519' | 'x25519' = 'ed25519'): string {
  const encoded = text(value, 200), key = createPublicKey({ key: binary(encoded), format: 'der', type: 'spki' })
  if (key.asymmetricKeyType !== type) throw new LanError(400, '设备密钥类型不兼容')
  return encoded
}
export function privateAddress(value: string): boolean {
  const address = value.replace(/^::ffff:/, '')
  if (isIP(address) !== 4) return false
  const [a, b] = address.split('.').map(Number)
  return a === 10 || a === 127 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}
export function endpoint(value: unknown): string {
  const url = new URL(text(value, 200))
  if (url.protocol !== 'http:' || !privateAddress(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new LanError(400, '只接受局域网 IPv4 地址和端口，例如 http://192.168.1.10:40195')
  return url.origin
}
export function commit(value: unknown): ValidCommit {
  const data = record(value), deleted = data.deleted
  if (typeof deleted !== 'boolean') throw new LanError(400, '无效删除标记')
  const size = integer(data.size, MAX_FILE_BYTES), sha256 = deleted ? null : hash(data.sha256)
  if (deleted && (data.sha256 !== null || size !== 0)) throw new LanError(400, '删除提交不能包含文件内容')
  return { operationId: uuid(data.operationId), fileId: uuid(data.fileId), path: safeRelative(text(data.path, 1024)),
    baseRevision: integer(data.baseRevision), deleted, size, sha256 }
}

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { binary, record, text } from './validation.ts'

export function derive(secret: Uint8Array, context: string, salt: Uint8Array = new Uint8Array()): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, salt, Buffer.from(`EDEN-LAN-2:${context}`), 32))
}
export function seal(value: unknown, secret: Uint8Array, context: string): unknown {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', derive(secret, context), iv)
  cipher.setAAD(Buffer.from(context))
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return { iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') }
}
export function open(value: unknown, secret: Uint8Array, context: string): unknown {
  const box = record(value), decipher = createDecipheriv('aes-256-gcm', derive(secret, context), binary(box.iv, 12))
  decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(binary(box.tag, 16))
  return JSON.parse(Buffer.concat([decipher.update(binary(text(box.data, 32 * 1024 * 1024))), decipher.final()]).toString('utf8'))
}

import { monFetch } from './transport.ts'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { modelEndpointSchema } from '@eden/api'

export interface MonServiceIdentity { coreBaseUrl: string; secret: string; userId: string }
export function serviceSignature(secret: string, service: string, scope: string, timestamp: string, nonce: string, path: string, body: Buffer): string {
  const hash = createHash('sha256').update(body).digest('hex')
  return createHmac('sha256', secret).update([service, scope, timestamp, nonce, 'POST', path, hash].join('\n')).digest('hex')
}
export async function acquireMonServiceToken(identity: MonServiceIdentity, signal: AbortSignal): Promise<string> {
  return (await acquireMonServiceLease(identity, signal)).token
}
export async function acquireMonServiceLease(identity: MonServiceIdentity, signal: AbortSignal) {
  const base = modelEndpointSchema.parse(identity.coreBaseUrl).replace(/\/$/, '')
  const pathname = '/api/internal/service-token/'
  const body = Buffer.from(JSON.stringify({ audience: 'monagent', requested_scope: 'self_awake:user_context' }))
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomUUID()
  const response = await monFetch(`${base}${pathname}`, { method: 'POST', body, redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), headers: {
      'content-type': 'application/json', 'x-mon-service-id': 'monagent', 'x-mon-service-scope': 'core:service_token',
      'x-mon-service-timestamp': timestamp, 'x-mon-service-nonce': nonce,
      'x-mon-service-signature': serviceSignature(identity.secret, 'monagent', 'core:service_token', timestamp, nonce, pathname, body),
    } })
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Core service identity rejected (${response.status})`) }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Core service token response is empty')
  const chunks: Uint8Array[] = []; let length = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.length
      if (length > 65536) { await reader.cancel(); throw new Error('Core service token response is too large') }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const result = z.object({ user_id: z.union([z.string(), z.number().int()]), token: z.string().min(1).max(8192),
    expires_in: z.number().positive().optional(), expires_at: z.string().optional() }).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  if (String(result.user_id) !== identity.userId) throw new Error('Core service identity user mismatch')
  const absolute = result.expires_at ? Date.parse(result.expires_at) : NaN
  const expiresAt = Math.min(Number.isFinite(absolute) ? absolute : Infinity, Date.now() + (result.expires_in ?? 1200) * 1000)
  if (expiresAt <= Date.now()) throw new Error('Core returned an expired service credential')
  return { token: result.token, expiresAt }
}

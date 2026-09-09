import { marketKeyAddSchema } from '@eden/api'
import { z } from 'zod'
const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const version = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/)
export { marketUrlSchema as marketUrl, marketSourceSchema as sourceSchema } from '@eden/api'
import { marketUrlSchema as marketUrl, marketSourceSchema as sourceSchema } from '@eden/api'
export const sourceIdSchema = z.object({ id }).strict()
export const keySchema = marketKeyAddSchema
const release = z.object({ version, revision: digest, url: marketUrl, sha256: digest }).strict()
export const payloadSchema = z.object({ generatedAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), expiresAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  plugins: z.array(z.object({ id, name: z.string().max(256), description: z.string().max(4000), versions: z.array(release).max(10000) }).strict()).max(10000).default([]),
  revocations: z.array(z.object({ pluginId: id, version, revision: digest, reason: z.string().max(4000) }).strict()).max(20000).default([]),
}).strict()
export const envelopeSchema = z.object({ schemaVersion: z.literal(1), keyId: id, payload: payloadSchema, signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict()
export type MarketSource = z.infer<typeof sourceSchema>
export type MarketPayload = z.infer<typeof payloadSchema>

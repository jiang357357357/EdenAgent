import { z } from 'zod'
export const marketKeyIdSchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,127}$/) }).strict()
export const marketKeyAddSchema = marketKeyIdSchema.extend({ publicKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/) })
export const marketKeyInfoSchema = marketKeyAddSchema.extend({ enabled: z.boolean(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
export type MarketKeyInfo = z.infer<typeof marketKeyInfoSchema>

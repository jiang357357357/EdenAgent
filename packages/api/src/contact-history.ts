import { z } from 'zod'
export const contactHistorySchema = z.object({ limit: z.number().int().min(1).max(100).default(10),
  beforeId: z.union([z.number().int().positive().safe(), z.string().regex(/^\d{1,20}$/)]).optional() }).strict()

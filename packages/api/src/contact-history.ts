import { z } from 'zod'
export const contactHistorySchema = z.object({}).strict()

export const ownerContactMessageSchema = z.object({ title: z.string().trim().min(1).max(256), message: z.string().trim().min(1).max(16000) }).strict()
export const ownerQqMessageSchema = ownerContactMessageSchema.extend({ title: z.string().trim().max(256).default('') }).strict()

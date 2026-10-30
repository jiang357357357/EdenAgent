import { z } from 'zod'

export const memoryModelStatusSchema = z.object({
  state: z.enum(['core', 'missing', 'downloading', 'ready', 'error', 'cancelled']),
  model: z.literal('bge-small-zh-v1.5'), path: z.string().nullable(),
  downloadedBytes: z.number().int().nonnegative(), totalBytes: z.number().int().positive(),
  error: z.string().nullable(),
})
export type MemoryModelStatus = z.infer<typeof memoryModelStatusSchema>
export const memoryModelRpcMethods = {
  'memory.model.status': { params: z.object({}).strict(), result: memoryModelStatusSchema },
  'memory.model.download': { params: z.object({ confirm: z.literal(true) }).strict(), result: memoryModelStatusSchema },
  'memory.model.cancel': { params: z.object({}).strict(), result: memoryModelStatusSchema },
} as const

import { z } from 'zod'

export const blobMimeSchema = z.string().min(1).max(255).regex(/^[\x20-\x7e]+$/)
export const blobInfoSchema = z.object({
  id: z.uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mime: blobMimeSchema,
  byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})
export type BlobInfo = z.infer<typeof blobInfoSchema>

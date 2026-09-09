import { z } from 'zod'
import { blobInfoSchema, blobMimeSchema } from './blobs.ts'

export const attachmentRefSchema = z.object({
  blobId: z.uuid(), mime: blobMimeSchema,
  filename: z.string().min(1).max(512).regex(/^[^\u0000-\u001f\u007f]+$/).optional(),
}).strict()
export const attachmentRefsSchema = z.array(attachmentRefSchema).max(32)
export const attachmentSnapshotSchema = attachmentRefSchema.extend({
  sha256: blobInfoSchema.shape.sha256,
  byteLength: blobInfoSchema.shape.byteLength,
  kind: z.enum(['image', 'file']),
})
export const attachmentSnapshotsSchema = z.array(attachmentSnapshotSchema).max(32)
export type AttachmentRef = z.infer<typeof attachmentRefSchema>
export type AttachmentSnapshot = z.infer<typeof attachmentSnapshotSchema>

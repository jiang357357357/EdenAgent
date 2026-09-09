import { attachmentRefsSchema, attachmentSnapshotsSchema, attachmentSnapshotSchema } from '@eden/api'
import type { AttachmentRef, AttachmentSnapshot } from '@eden/api'
import type { RuntimeImage } from '@eden/runtime-pi'
import type { BlobService } from '../blobs/index.ts'
import { imageMime, assertImageSignature } from './image-kind.ts'

function validateBudget(snapshots: AttachmentSnapshot[]): void {
  const total = snapshots.reduce((sum, item) => sum + item.byteLength, 0)
  if (total > 32 * 1024 * 1024) throw new Error('Attachments exceed the 32 MiB input limit')
  if (snapshots.filter(item => item.kind === 'image').length > 8) throw new Error('At most eight images may be submitted per input')
}

export class AttachmentService {
  constructor(private readonly blobs: BlobService) {}

  async snapshot(references: readonly AttachmentRef[]): Promise<AttachmentSnapshot[]> {
    const refs = attachmentRefsSchema.parse(references)
    const snapshots = refs.map(ref => {
      const info = this.blobs.info(ref.blobId)
      if (ref.mime !== info.mime) throw new Error('Attachment MIME differs from its Blob record')
      return attachmentSnapshotSchema.parse({ ...ref, sha256: info.sha256, byteLength: info.byteLength,
        kind: imageMime(info.mime) ? 'image' : 'file' })
    })
    validateBudget(snapshots)
    // Verify all content before the caller can accept the input into its durable queue.
    for (const snapshot of snapshots) await this.read(snapshot)
    return snapshots
  }

  async read(value: AttachmentSnapshot): Promise<Buffer> {
    const snapshot = attachmentSnapshotSchema.parse(value)
    validateBudget([snapshot])
    const info = this.blobs.info(snapshot.blobId)
    if (info.sha256 !== snapshot.sha256 || info.mime !== snapshot.mime || info.byteLength !== snapshot.byteLength) {
      throw new Error('Attachment no longer matches the accepted snapshot')
    }
    const mime = imageMime(info.mime)
    if (snapshot.kind !== (mime ? 'image' : 'file')) throw new Error('Attachment kind differs from its MIME')
    const { bytes } = await this.blobs.read(snapshot.blobId)
    if (mime) assertImageSignature(bytes, mime)
    return bytes
  }

  async images(values: readonly AttachmentSnapshot[]): Promise<RuntimeImage[]> {
    const snapshots = attachmentSnapshotsSchema.parse(values)
    validateBudget(snapshots)
    const images: RuntimeImage[] = []
    for (const snapshot of snapshots) {
      const bytes = await this.read(snapshot)
      if (snapshot.kind !== 'image') continue
      images.push({ type: 'image', data: bytes.toString('base64'), mimeType: imageMime(snapshot.mime)! })
    }
    return images
  }
}

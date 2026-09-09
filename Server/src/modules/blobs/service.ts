import { blobMimeSchema, type BlobInfo } from '@eden/api'
import { BlobFiles, digest } from './files.ts'
import type { BlobRepository } from './repository.ts'
import { BlobNotFoundError } from './errors.ts'

export class BlobService {
  private readonly files: BlobFiles

  constructor(root: string, private readonly repository: BlobRepository, private readonly maxBytes = 32 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024 * 1024) throw new Error('Invalid blob size limit')
    this.files = new BlobFiles(root, maxBytes)
  }

  async put(content: Uint8Array, mime: string): Promise<BlobInfo> {
    if (content.byteLength > this.maxBytes) throw new Error('Blob exceeds size limit')
    blobMimeSchema.parse(mime)
    const bytes = Buffer.from(content)
    const hash = digest(bytes)
    await this.files.put(hash, bytes)
    return this.repository.put(hash, mime, bytes.length)
  }

  async read(id: string): Promise<{ info: BlobInfo; bytes: Buffer }> {
    const info = this.info(id)
    const bytes = await this.files.read(info.sha256, info.byteLength)
    return { info, bytes }
  }

  info(id: string): BlobInfo {
    const info = this.repository.read(id)
    if (!info) throw new BlobNotFoundError()
    return info
  }
}

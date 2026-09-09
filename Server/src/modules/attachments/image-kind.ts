import type { RuntimeImage } from '@eden/runtime-pi'

export function imageMime(mime: string): RuntimeImage['mimeType'] | undefined {
  const value = mime.split(';')[0]!.trim().toLowerCase()
  if (value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif') return value
  return undefined
}

/** Signature check only; image decoding remains the model provider's responsibility. */
export function assertImageSignature(bytes: Buffer, mime: RuntimeImage['mimeType']): void {
  const hex = bytes.subarray(0, 12).toString('hex')
  const valid = {
    'image/png': hex.startsWith('89504e470d0a1a0a'),
    'image/jpeg': hex.startsWith('ffd8ff'),
    'image/gif': bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a',
    'image/webp': bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
  }
  if (!valid[mime]) throw new Error('Attachment image signature does not match its MIME')
}

import type { RuntimeImage } from './contracts.ts'

const supported = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Copy and validate before pi can persist or transmit caller-owned input. */
export function runtimeImages(images: readonly RuntimeImage[] = []): RuntimeImage[] {
  if (images.length > 8) throw new Error('At most eight images may be submitted per input')
  let total = 0
  return images.map(image => {
    if (image.type !== 'image' || !supported.has(image.mimeType)) throw new Error('Unsupported runtime image type')
    if (!image.data || image.data.length > 44_739_244 || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) {
      throw new Error('Invalid runtime image base64')
    }
    const padding = image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0
    const final = alphabet.indexOf(image.data[image.data.length - padding - 1]!)
    if (final < 0 || padding === 2 && (final & 15) !== 0 || padding === 1 && (final & 3) !== 0)
      throw new Error('Noncanonical runtime image base64')
    // Validate canonical pad bits without allocating decoded bytes and another
    // full base64 string in the worker solely to compare the round trip.
    total += image.data.length / 4 * 3 - padding
    if (total > 32 * 1024 * 1024) throw new Error('Runtime image input exceeds 32 MiB')
    return { type: 'image', data: image.data, mimeType: image.mimeType }
  })
}

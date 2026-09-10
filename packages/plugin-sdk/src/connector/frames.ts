import { jsonValue } from '@eden/api/connector'
import type { JsonValue } from '@eden/api/connector'
export const maxWorkerFrame = 8 * 1024 * 1024
export function encodeWorkerFrame(value: JsonValue): Buffer {
  const body = Buffer.from(JSON.stringify(value))
  if (!body.length || body.length > maxWorkerFrame) throw new Error('Connector frame exceeds limit')
  const header = Buffer.alloc(4); header.writeUInt32BE(body.length)
  return Buffer.concat([header, body])
}
/** Four-byte big-endian length framing. Allocate only after a complete validated header. */
export class WorkerFrameReader {
  private readonly header = Buffer.alloc(4)
  private headerBytes = 0
  private body: Buffer | undefined
  private bodyBytes = 0
  push(chunk: Buffer, receive: (value: JsonValue) => void): void {
    let offset = 0
    while (offset < chunk.length) {
      if (!this.body) {
        const count = Math.min(4 - this.headerBytes, chunk.length - offset)
        chunk.copy(this.header, this.headerBytes, offset, offset + count)
        offset += count; this.headerBytes += count
        if (this.headerBytes !== 4) continue
        const size = this.header.readUInt32BE()
        if (!size || size > maxWorkerFrame) throw new Error('Invalid connector frame length')
        this.body = Buffer.allocUnsafe(size); this.bodyBytes = 0
      }
      const count = Math.min(this.body.length - this.bodyBytes, chunk.length - offset)
      chunk.copy(this.body, this.bodyBytes, offset, offset + count)
      offset += count; this.bodyBytes += count
      if (this.bodyBytes === this.body.length) {
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(this.body)
        this.body = undefined; this.headerBytes = 0; this.bodyBytes = 0
        receive(jsonValue.parse(JSON.parse(raw)))
      }
    }
  }
  end() { if (this.headerBytes || this.body) throw new Error('Connector stream ended inside a frame') }
}

import type { IncomingMessage } from 'node:http'

export class BodyError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function readBlobBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let length = 0
    const cleanup = () => {
      clearTimeout(timer)
      request.removeListener('data', data)
      request.removeListener('end', end)
      request.removeListener('error', fail)
      request.removeListener('aborted', aborted)
    }
    const fail = (error: Error) => { cleanup(); request.pause(); reject(error) }
    const aborted = () => fail(new BodyError(400, 'Upload interrupted'))
    const data = (chunk: Buffer) => {
      length += chunk.length
      if (length > limit) { fail(new BodyError(413, 'Blob exceeds size limit')); return }
      chunks.push(chunk)
    }
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, length)) }
    const timer = setTimeout(() => fail(new BodyError(408, 'Upload timed out')), 30_000)
    timer.unref()
    // An aborted HTTP request may emit an error after the aborted callback has cleaned up.
    request.once('error', () => {})
    request.on('data', data).once('end', end).once('error', fail).once('aborted', aborted)
  })
}

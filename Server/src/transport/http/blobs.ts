import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { blobInfoSchema, blobMimeSchema } from '@eden/api'
import { BlobNotFoundError, type BlobService } from '../../modules/blobs/index.ts'
import type { ServerConfig } from '../../bootstrap/config.ts'
import { BodyError, readBlobBody } from './blob-body.ts'

function errorResponse(response: ServerResponse, status: number, message: string): void {
  if (response.destroyed || response.writableEnded) return
  response.setHeader('connection', 'close')
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message }))
}

function authorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization ?? ''
  if (!header.startsWith('Bearer ')) return false
  const supplied = Buffer.from(header.slice(7))
  const expected = Buffer.from(token)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function access(request: IncomingMessage, response: ServerResponse, config: ServerConfig): boolean {
  const origin = request.headers.origin
  response.setHeader('vary', 'Origin')
  if (origin && !config.allowedOrigins.includes(origin)) {
    errorResponse(response, 403, 'Origin denied'); return false
  }
  if (origin) response.setHeader('access-control-allow-origin', origin)
  if (request.method === 'OPTIONS') {
    const method = request.headers['access-control-request-method']
    const headers = String(request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean)
    if (!origin || !['GET', 'POST'].includes(String(method)) || headers.some(header => !['authorization', 'content-type'].includes(header))) {
      errorResponse(response, 403, 'Preflight denied'); return false
    }
    response.writeHead(204, { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization, content-type' }).end()
    return false
  }
  if (!authorized(request, config.token)) { errorResponse(response, 401, 'Unauthorized'); return false }
  return true
}

export class BlobHttp {
  private closing = false
  private readonly tasks = new Map<Promise<void>, IncomingMessage>()

  constructor(private readonly service: BlobService, private readonly config: ServerConfig) {}

  handle(request: IncomingMessage, response: ServerResponse): boolean {
    const url = request.url ?? ''
    if (url !== '/blobs' && !url.startsWith('/blobs/')) return false
    response.setHeader('cache-control', 'no-store')
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('content-security-policy', "default-src 'none'; sandbox")
    if (this.closing) { errorResponse(response, 503, 'Server closing'); return true }
    if (!access(request, response, this.config)) return true
    if (this.tasks.size >= 8) { errorResponse(response, 503, 'Blob request limit exceeded'); return true }
    const task = this.dispatch(request, response).catch(error => {
      if (error instanceof BodyError) errorResponse(response, error.status, error.message)
      else if (error instanceof BlobNotFoundError) errorResponse(response, 404, 'Blob not found')
      else errorResponse(response, 500, 'Blob operation failed')
    })
    this.tasks.set(task, request)
    void task.then(() => this.tasks.delete(task))
    return true
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.url === '/blobs' && request.method === 'POST') {
      const limit = this.config.maxBlobBytes ?? 32 * 1024 * 1024
      const declared = request.headers['content-length']
      if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new BodyError(413, 'Blob exceeds size limit')
      if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') throw new BodyError(415, 'Content encoding unsupported')
      const mime = blobMimeSchema.safeParse(request.headers['content-type'] ?? 'application/octet-stream')
      if (!mime.success) throw new BodyError(400, 'Invalid content type')
      const bytes = await readBlobBody(request, limit)
      if (this.closing || request.aborted) throw new BodyError(503, 'Upload interrupted')
      const info = await this.service.put(bytes, mime.data)
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(info))
      return
    }
    const id = blobInfoSchema.shape.id.safeParse(request.url?.slice('/blobs/'.length))
    if (request.method !== 'GET' || !id.success) throw new BodyError(404, 'Not found')
    const { info, bytes } = await this.service.read(id.data)
    response.writeHead(200, { 'content-type': info.mime, 'content-length': info.byteLength, 'content-disposition': 'attachment' }).end(bytes)
  }

  async close(): Promise<void> {
    this.closing = true
    for (const request of this.tasks.values()) if (!request.complete) request.destroy()
    await Promise.all(this.tasks.keys())
  }
}

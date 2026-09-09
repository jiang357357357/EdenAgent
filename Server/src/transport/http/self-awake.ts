import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { serviceSignature } from '@eden/integrations'
import type { SelfAwakeBridge } from '../../modules/self-awake/index.ts'
import { BodyError, readBlobBody } from './blob-body.ts'

const paths = ['/internal/self-awake/run', '/internal/self-awake/status']
function reply(response: ServerResponse, status: number, value: unknown) {
  if (!response.destroyed && !response.writableEnded) response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value))
}

export class SelfAwakeHttp {
  private readonly tasks = new Map<Promise<void>, IncomingMessage>()
  private closed = false
  constructor(private readonly origin: 'mon' | 'local', private readonly bridge?: SelfAwakeBridge) {}

  handle(request: IncomingMessage, response: ServerResponse): boolean {
    if (!paths.includes(request.url ?? '')) return false
    if (this.origin !== 'mon') { reply(response, 404, { error: 'Not found' }); return true }
    if (this.closed || !this.bridge) { reply(response, 503, { error: 'Self-awake service identity unavailable' }); return true }
    if (request.method !== 'POST' || request.headers.origin) { reply(response, 403, { error: 'Service requests only' }); return true }
    if (this.tasks.size >= 8) { reply(response, 429, { error: 'Self-awake request limit reached' }); return true }
    const task = this.dispatch(request, response).catch(error => {
      reply(response, error instanceof BodyError ? error.status : 400, { error: error instanceof BodyError ? error.message : 'Self-awake request could not be processed' })
    })
    this.tasks.set(task, request)
    void task.then(() => this.tasks.delete(task))
    return true
  }

  async close(): Promise<void> {
    this.closed = true
    const closing = this.bridge?.close()
    for (const request of this.tasks.values()) request.destroy()
    await closing
    await Promise.all(this.tasks.keys())
  }

  private async dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBlobBody(request, 65536)
    if (this.closed) { reply(response, 503, { error: 'Server is closing' }); return }
    if (!this.authorize(request, body)) { reply(response, 401, { error: 'Invalid service signature' }); return }
    const raw: unknown = JSON.parse(body.toString('utf8'))
    const value = request.url === paths[1] ? this.bridge!.readStatus(raw) : await this.bridge!.submit(raw)
    reply(response, 200, value)
  }

  private authorize(request: IncomingMessage, body: Buffer): boolean {
    const header = (key: string) => typeof request.headers[key] === 'string' ? request.headers[key] as string : ''
    const timestamp = header('x-mon-service-timestamp'), nonce = header('x-mon-service-nonce'), signature = header('x-mon-service-signature')
    if (header('x-mon-service-id') !== 'monos' || header('x-mon-service-scope') !== 'self_awake:submit') return false
    if (!/^\d{1,12}$/.test(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false
    if (!nonce || nonce.length > 128 || !/^[0-9a-fA-F]{64}$/.test(signature)) return false
    const expected = serviceSignature(this.bridge!.identity.secret, 'monos', 'self_awake:submit', timestamp, nonce, request.url!, body)
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return false
    try { this.bridge!.repository.consumeNonce(nonce, Date.now() + 600000); return true } catch { return false }
  }
}

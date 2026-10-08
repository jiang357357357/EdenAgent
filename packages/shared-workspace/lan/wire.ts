import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { LanError } from './contracts.ts'
import { endpoint, privateAddress } from './validation.ts'

export const maximumEnvelopeBytes = 32 * 1024 * 1024
export async function readJson(stream: AsyncIterable<Uint8Array>, maximum = maximumEnvelopeBytes): Promise<unknown> {
  const chunks: Uint8Array[] = []; let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > maximum) throw new LanError(413, '局域网共享消息超过大小限制')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export async function post(address: string, route: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  const base = endpoint(address)
  const response = await fetch(`${base}${route}`, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) { await response.body?.cancel(); throw new LanError(response.status, response.status === 403 ? '设备配对失效或没有共享权限' : '局域网设备暂时无法处理请求') }
  if (!response.body) throw new LanError(502, '局域网设备响应为空')
  return readJson(response.body)
}
export class LanHttpServer {
  private server: Server | undefined
  private active = 0
  private readonly requests = new Set<Promise<void>>()
  port = 0
  private readonly handler: (route: string, body: unknown, source: string) => Promise<unknown>
  private readonly allowed: () => boolean
  private readonly host: string
  private readonly requestedPort: number
  constructor(handler: (route: string, body: unknown, source: string) => Promise<unknown>, allowed: () => boolean, host = '0.0.0.0', requestedPort = 0) {
    this.handler = handler; this.allowed = allowed; this.host = host; this.requestedPort = requestedPort
  }
  async start() {
    if (this.server) return
    const server = createServer((req, res) => {
      const work = this.handle(req, res); this.requests.add(work)
      void work.finally(() => this.requests.delete(work)).catch(() => { req.destroy(); res.destroy() })
    }); this.server = server
    server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 1000; server.maxConnections = 16
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => { this.server = undefined; reject(error) }
      server.once('error', failed)
      server.listen(this.requestedPort, this.host, () => { server.off('error', failed); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('无法确定局域网共享监听地址')
    this.port = address.port
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    let counted = false
    try {
      if (!this.allowed() || !privateAddress(req.socket.remoteAddress ?? '')) throw new LanError(403, '局域网共享不可用')
      if (req.method !== 'POST' || (req.url !== '/eden-lan/v2/pair' && req.url !== '/eden-lan/v2/rpc')) throw new LanError(404, '接口不存在')
      if (this.active >= 8) throw new LanError(429, '共享请求过多，请稍后重试')
      this.active++; counted = true
      const body = await readJson(req, req.url.endsWith('/pair') ? 12 * 1024 : maximumEnvelopeBytes)
      const result = await this.handler(req.url, body, req.socket.remoteAddress!.replace(/^::ffff:/, ''))
      if (!this.allowed()) throw new LanError(503, '局域网共享已关闭')
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(result))
    } catch (error) {
      res.writeHead(error instanceof LanError ? error.status : 400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ error: 'request_rejected' }))
    } finally { if (counted) this.active-- }
  }
  async close() {
    const server = this.server; this.server = undefined; this.port = 0
    if (!server) return
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() })
    await Promise.allSettled([...this.requests])
  }
}

import type { IncomingMessage } from 'node:http'
import { createRequire } from 'node:module'
// Node 22's ESM HTTP namespace evaluates lazy WebSocket exports and loads Undici/WASM.
// Read the CommonJS HTTP object without enumerating those unrelated exports in jitless workers.
const http: typeof import('node:http') = createRequire(import.meta.url)('node:http')
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

/** The host owns the destination. TLS still verifies the declared origin over the Unix bridge. */
export function bridgeHttp(url: URL, method: 'GET' | 'POST', headers: Record<string, string>, signal: AbortSignal, body?: string): Promise<IncomingMessage> {
  const socketPath = process.env.EDEN_CONNECTOR_NETWORK_SOCKET
  if (!socketPath || !['http:', 'https:'].includes(url.protocol)) throw new Error('Approved HTTP bridge is unavailable')
  const secure = url.protocol === 'https:', agent = secure ? new https.Agent() : new http.Agent()
  agent.createConnection = () => secure
    ? tls.connect({ socket: net.connect(socketPath), servername: url.hostname, rejectUnauthorized: true })
    : net.connect(socketPath)
  return new Promise((resolve, reject) => {
    const request = (secure ? https : http).request(url, { method, headers, signal, agent })
    const timer = setTimeout(() => request.destroy(new Error('Connector HTTP headers timed out')), 15000)
    request.once('error', error => { clearTimeout(timer); agent.destroy(); reject(error) })
    request.once('response', response => {
      clearTimeout(timer)
      response.once('close', () => agent.destroy())
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.destroy(); reject(new Error('Connector HTTP endpoint rejected request')); return
      }
      resolve(response)
    })
    request.end(body)
  })
}

export async function* readNdjson(response: IncomingMessage, limit = 4 * 1024 * 1024): AsyncGenerator<unknown> {
  let pending: Buffer = Buffer.alloc(0)
  for await (const raw of response) {
    pending = Buffer.concat([pending, Buffer.from(raw)])
    let end: number
    while ((end = pending.indexOf(10)) >= 0) {
      if (end > limit) throw new Error('NDJSON record exceeds limit')
      const line = new TextDecoder('utf-8', { fatal: true }).decode(pending.subarray(0, end)).trim()
      pending = pending.subarray(end + 1)
      if (line) yield JSON.parse(line)
    }
    if (pending.length > limit) throw new Error('NDJSON record exceeds limit')
  }
  if (pending.toString('utf8').trim()) throw new Error('NDJSON stream ended inside a record')
}

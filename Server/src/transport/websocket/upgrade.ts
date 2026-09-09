import { timingSafeEqual } from 'node:crypto'
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { tokenProtocolPrefix, websocketProtocol } from '@eden/api'
import type { ServerConfig } from '../../bootstrap/config.ts'
import type { SessionService } from '../../modules/sessions/index.ts'
import { RpcRouter } from '../rpc/router.ts'
import { sessionRoutes, wireEvent } from '../rpc/session.routes.ts'
import type { JsonValue } from '@eden/api'
import { reviewRoutes } from '../rpc/review-routes.ts'

function authenticated(request: IncomingMessage, config: ServerConfig): boolean {
  const origin = request.headers.origin
  if (origin && !config.allowedOrigins.includes(origin)) return false
  const protocols = (request.headers['sec-websocket-protocol'] ?? '').split(',').map(value => value.trim())
  if (!protocols.includes(websocketProtocol)) return false
  const token = protocols.find(value => value.startsWith(tokenProtocolPrefix))?.slice(tokenProtocolPrefix.length)
  if (!token) return false
  const expected = Buffer.from(config.token)
  const supplied = Buffer.from(token)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export function attachWebsocket(server: HttpServer, config: ServerConfig, sessions: SessionService,
  extraRoutes: Record<string, (params: JsonValue) => JsonValue | Promise<JsonValue>> = {}, prepareVoice?: (sessionId: string) => (client: WebSocket) => void): WebSocketServer {
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024,
    handleProtocols: protocols => protocols.has(websocketProtocol) ? websocketProtocol : false })
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const isVoice = url.pathname === '/voice/stt/realtime' && prepareVoice !== undefined
    if ((!isVoice && request.url !== '/rpc') || !authenticated(request, config)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    if (isVoice) {
      try {
        const connect = prepareVoice!(url.searchParams.get('session_id') ?? '')
        websocket.handleUpgrade(request, socket, head, connect)
      } catch { socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); socket.destroy() }
      return
    }
    websocket.handleUpgrade(request, socket, head, client => websocket.emit('connection', client))
  })
  websocket.on('connection', client => {
    const routes = { ...sessionRoutes(sessions), ...extraRoutes }
    const router = new RpcRouter(config.origin, config.migrationReview ? reviewRoutes(routes) : routes)
    let initialized = false
    const send = (value: unknown) => {
      if (client.readyState !== WebSocket.OPEN) return
      if (client.bufferedAmount > 4 * 1024 * 1024) { client.close(1013, 'Event stream lagged'); return }
      client.send(JSON.stringify(value))
    }
    const unsubscribe = sessions.repository.events.subscribe(event => {
      if (initialized) send({ jsonrpc: '2.0', method: 'session.event', params: wireEvent(event) })
    })
    let pending = Promise.resolve()
    let pendingCount = 0
    client.on('message', (data, binary) => {
      if (binary || ++pendingCount > 64) { client.close(1008, 'Request queue limit exceeded'); return }
      pending = pending.then(async () => {
        if (client.readyState !== WebSocket.OPEN) return
        let raw: unknown
        try { raw = JSON.parse(data.toString()) }
        catch { send({ jsonrpc: '2.0', id: null, result: null, error: { code: -32700, message: 'Invalid JSON' } }); return }
        const response = await router.dispatch(raw)
        if (response) {
          send(response)
          if (typeof response === 'object' && !Array.isArray(response) && response.error === null && response.result &&
            typeof response.result === 'object' && !Array.isArray(response.result) && response.result.serverName) initialized = true
        }
      }).catch(() => { client.close(1011, 'RPC processing failed') }).finally(() => { pendingCount-- })
    })
    client.on('close', unsubscribe)
    client.on('error', unsubscribe)
  })
  return websocket
}

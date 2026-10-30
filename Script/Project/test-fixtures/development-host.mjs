import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { tokenProtocolPrefix, websocketProtocol } from '@eden/api/rpc'

export async function developmentHost({ workspaceId = 'a'.repeat(64), origin = 'mon' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'eden-development-host-'))
  const dataRoot = path.join(root, origin)
  const tokenFile = path.join(dataRoot, 'capability.token')
  const token = 'fixture_capability_'.padEnd(43, 'x')
  await mkdir(dataRoot)
  await writeFile(tokenFile, token)
  const state = { health: { runtimeOrigin: origin, workspaceId, serverVersion: '2.0.0-dev.0' }, stall: false, upgrades: 0, rpcMessages: 0 }
  const server = createServer((request, response) => {
    if (request.url === '/probe') { response.end('alive'); return }
    if (state.stall) return
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(state.health))
  })
  const sockets = new WebSocketServer({ noServer: true, handleProtocols: protocols => protocols.has(websocketProtocol) ? websocketProtocol : false })
  server.on('upgrade', (request, socket, head) => {
    state.upgrades++
    if (!request.headers['sec-websocket-protocol']?.split(',').map(value => value.trim()).includes(`${tokenProtocolPrefix}${token}`)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return
    }
    sockets.handleUpgrade(request, socket, head, client => {
      client.on('error', () => {})
      client.on('message', () => state.rpcMessages++)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return { root, dataRoot, tokenFile, token, port, workspaceId, origin, state,
    options: { origin, port, workspaceId, dataRoot, tokenFile },
    async close() {
      for (const client of sockets.clients) client.terminate()
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      await new Promise(resolve => sockets.close(resolve))
      await rm(root, { recursive: true, force: true })
    },
  }
}

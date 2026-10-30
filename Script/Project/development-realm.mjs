import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { WebSocket } from 'ws'
import { tokenProtocolPrefix, websocketProtocol } from '@eden/api/rpc'

/** Probe by binding, never by terminating a listener owned by another launcher. */
export async function assertDevelopmentPortAvailable(port, label) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid ${label} port: ${port}`)
  const probe = createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', () => reject(new Error(`${label} 端口 ${port} 已被占用或不可用；未停止现有进程，请使用已有客户端或先停止对应启动器`)))
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, resolve)
  })
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
}

async function acceptsCapability(port, token, timeoutMs) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/rpc`, [websocketProtocol, `${tokenProtocolPrefix}${token}`], {
      handshakeTimeout: timeoutMs, followRedirects: false,
    })
    let settled = false
    const finish = accepted => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.terminate()
      accepted ? resolve() : reject(new Error(`现有 Agent 端口 ${port} 不接受所配置的能力令牌；未重启或改写该服务`))
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    socket.once('open', () => finish(socket.protocol === websocketProtocol))
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
  })
}

/** A compatible host is borrowed; only a new host belongs to this development process. */
export async function resolveDevelopmentRealm({ origin, port, dataRoot, workspaceId, tokenFile = path.join(dataRoot, 'capability.token'), timeoutMs = 3000 }) {
  if (!['mon', 'local'].includes(origin)) throw new Error(`Invalid runtime origin: ${origin}`)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid ${origin} port: ${port}`)
  const base = { origin, port, dataRoot, tokenFile }
  let response
  try {
    response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
  } catch {
    // This also refuses a slow, starting or unrelated listener instead of taking its port.
    await assertDevelopmentPortAvailable(port, `${origin} Agent`)
    return { ...base, owned: true, token: randomBytes(32).toString('base64url') }
  }
  let health
  try { health = await response.json() }
  catch { throw new Error(`${origin} 端口 ${port} 不是可复用的 Agent 健康接口；未停止现有进程`) }
  if (!response.ok || health.runtimeOrigin !== origin || health.serverVersion !== '2.0.0-dev.0'
    || !workspaceId || health.workspaceId !== workspaceId) {
    throw new Error(`${origin} 端口 ${port} 的服务版本、世界或工作区不匹配；未停止现有进程`)
  }
  let token
  try { token = (await readFile(tokenFile, 'utf8')).trim() }
  catch { throw new Error(`无法读取现有 ${origin} 服务的能力令牌文件：${tokenFile}；请核对数据目录或令牌文件配置`) }
  if (!/^[A-Za-z0-9_-]{32,4096}$/.test(token)) throw new Error(`现有 ${origin} 服务能力令牌文件无效：${tokenFile}`)
  // The unauthenticated health response alone cannot prove that this data root owns the endpoint.
  // Stop after the upgrade: no account initialization, session input or other RPC is sent.
  await acceptsCapability(port, token, timeoutMs)
  return { ...base, owned: false, token }
}

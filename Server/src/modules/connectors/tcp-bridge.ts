import { createServer, connect, isIP, type Socket } from 'node:net'
import { mkdtemp, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** The client cannot choose a destination. DNS is resolved by the caller before opening this bridge. */
export async function createTcpBridge(target: { address: string; port: number; limit: number }, authorize: () => void, signal: AbortSignal) {
  if (process.platform !== 'linux' || !isIP(target.address) || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535 || !Number.isInteger(target.limit) || target.limit < 1 || target.limit > 32) throw new Error('Invalid fixed-target bridge configuration')
  signal.throwIfAborted(); authorize()
  const directory = await mkdtemp(path.join(tmpdir(), 'eden-connector-net-'))
  const socket = path.join(directory, 'transport.sock'), sockets = new Set<Socket>()
  let closed = false, closing: Promise<void> | undefined
  let monitor: ReturnType<typeof setInterval> | undefined
  const server = createServer(client => {
    try { authorize(); signal.throwIfAborted(); if (closed || sockets.size >= target.limit * 2) throw new Error('Bridge connection limit') }
    catch { client.destroy(); return }
    const upstream = connect({ host: target.address, port: target.port })
    sockets.add(client); sockets.add(upstream)
    const destroy = () => { client.destroy(); upstream.destroy() }
    for (const stream of [client, upstream]) {
      stream.on('error', destroy)
      stream.once('close', () => { sockets.delete(stream); destroy() })
    }
    upstream.setTimeout(10000, destroy)
    upstream.once('connect', () => { upstream.setTimeout(0); client.pipe(upstream); upstream.pipe(client) })
  })
  const close = () => closing ??= (async () => {
    closed = true; signal.removeEventListener('abort', abort)
    if (monitor) clearInterval(monitor)
    for (const stream of sockets) stream.destroy()
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  })()
  const abort = () => { void close().catch(() => { process.stderr.write('Connector network bridge cleanup failed\n') }) }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject); server.listen(socket, () => { server.removeListener('error', reject); resolve() })
    })
    server.on('error', abort)
    await chmod(socket, 0o600)
    signal.addEventListener('abort', abort, { once: true }); signal.throwIfAborted()
    monitor = setInterval(() => { try { authorize() } catch { abort() } }, 2000)
    monitor.unref()
    return { directory, close }
  } catch (error) { await close(); throw error }
}

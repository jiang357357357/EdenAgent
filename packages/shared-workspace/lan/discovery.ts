import { createSocket, type Socket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { signature, verified } from './identity.ts'
import { integer, privateAddress, publicKey, record, text, uuid } from './validation.ts'
import type { Identity } from './contracts.ts'

const group = '239.255.73.42', port = 40196
export function localAddresses(httpPort: number): string[] {
  return [...new Set(Object.values(networkInterfaces()).flatMap(rows => (rows ?? []).filter(row => row.family === 'IPv4' && !row.internal && privateAddress(row.address))
    .map(row => `http://${row.address}:${httpPort}`)))]
}
export interface Advertisement { deviceId: string; name: string; publicKey: string; address: string; seenAt: number }
export class LanDiscovery {
  private socket: Socket | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly seen = new Map<string, Advertisement>()
  error: string | null = null
  private readonly device: Identity
  private readonly httpPort: number
  constructor(device: Identity, httpPort: number) { this.device = device; this.httpPort = httpPort }
  async start(): Promise<void> {
    if (this.socket) return
    const socket = createSocket({ type: 'udp4', reuseAddr: true }); this.socket = socket
    socket.on('message', (bytes, source) => this.receive(bytes, source.address))
    socket.on('error', error => { this.error = `局域网发现不可用：${error.message}；可使用配对邀请中的地址连接` })
    await new Promise<void>(resolve => { socket.once('listening', resolve); socket.once('error', () => resolve()); socket.bind(port, '0.0.0.0') })
    if (this.error) return
    try {
      socket.setMulticastTTL(1); socket.setMulticastLoopback(true)
      const interfaces = localAddresses(this.httpPort).map(address => new URL(address).hostname)
      if (!interfaces.length) socket.addMembership(group)
      else for (const address of interfaces) socket.addMembership(group, address)
      this.announce()
      this.timer = setInterval(() => this.announce(), 10_000); this.timer.unref()
    } catch (error) { this.error = `局域网发现不可用：${(error as Error).message}；可使用配对地址连接` }
  }
  private announce() {
    const socket = this.socket
    if (!socket) return
    const data = JSON.stringify({ protocol: 2, deviceId: this.device.deviceId, name: this.device.name, publicKey: this.device.publicKey, port: this.httpPort, timestamp: Date.now() })
    const bytes = Buffer.from(JSON.stringify({ data, signature: signature(data, this.device) }))
    const send = () => socket.send(bytes, port, group, error => { if (error) this.error = `局域网广播失败：${error.message}` })
    try {
      const interfaces = localAddresses(this.httpPort).map(address => new URL(address).hostname)
      if (!interfaces.length) send()
      else for (const address of interfaces) { socket.setMulticastInterface(address); send() }
    } catch (error) { this.error = `局域网广播失败：${(error as Error).message}` }
  }
  receive(bytes: Uint8Array, source: string): void {
    if (bytes.length > 4096 || !privateAddress(source)) return
    try {
      const envelope = record(JSON.parse(Buffer.from(bytes).toString('utf8'))), raw = text(envelope.data, 2000), data = record(JSON.parse(raw))
      const key = publicKey(data.publicKey), id = uuid(data.deviceId), tcpPort = integer(data.port, 65535), timestamp = integer(data.timestamp)
      if (data.protocol !== 2 || !tcpPort || id === this.device.deviceId || Math.abs(Date.now() - timestamp) > 60_000 || !verified(raw, key, envelope.signature)) return
      if (this.seen.size >= 256 && !this.seen.has(id)) this.seen.delete(this.seen.keys().next().value!)
      this.seen.set(id, { deviceId: id, name: text(data.name), publicKey: key, address: `http://${source.replace(/^::ffff:/, '')}:${tcpPort}`, seenAt: Date.now() })
    } catch { /* Untrusted and malformed UDP advertisements never establish a pairing. */ }
  }
  peers(): Advertisement[] {
    const cutoff = Date.now() - 35_000
    for (const [id, peer] of this.seen) if (peer.seenAt < cutoff) this.seen.delete(id)
    return [...this.seen.values()]
  }
  close() {
    if (this.timer) clearInterval(this.timer)
    if (this.socket) { try { this.socket.close() } catch { /* A bind failure may already have closed this socket. */ } }
    this.timer = undefined; this.socket = undefined; this.seen.clear()
  }
}

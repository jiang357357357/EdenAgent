import path from 'node:path'
import { SnapshotStore } from '../client/snapshots.ts'
import { LanRepository } from './repository.ts'
import { LanLibraryService } from './library-service.ts'
import { identity } from './identity.ts'
import { LanDiscovery, localAddresses } from './discovery.ts'
import { LanHttpServer } from './wire.ts'
import { LanTransport } from './transport.ts'
import { LanPairing } from './pairing.ts'
import { LanError, type LanOptions, type LanRuntime, type NetworkStatus, type Peer } from './contracts.ts'

export class SharedLanRuntime implements LanRuntime {
  private readonly repository: LanRepository
  private readonly server: LanHttpServer
  private discovery: LanDiscovery | undefined
  private readonly pairing: LanPairing
  private controller = new AbortController()
  private starting: Promise<void> | undefined
  private stopping: Promise<void> = Promise.resolve()
  private closed = false
  readonly remote: LanTransport
  private readonly options: LanOptions
  constructor(options: LanOptions) {
    this.options = options
    const root = path.join(options.dataRoot, 'lan')
    this.repository = new LanRepository(root, identity(root, options.name))
    const library = new LanLibraryService(this.repository, new SnapshotStore(root), () => this.active(), () => options.canPublish())
    this.remote = new LanTransport(this.repository, library, peer => this.peerAddresses(peer), () => this.controller.signal)
    this.pairing = new LanPairing(this.repository, () => this.addresses(), () => this.active() && !!this.server.port)
    this.server = new LanHttpServer((route, body, source) => route.endsWith('/pair') ? this.pairing.accept(body, source) : this.remote.receive(body),
      () => this.active(), options.host, options.port)
  }
  private active() { return !this.closed && !this.controller.signal.aborted && this.options.active() }
  async start(): Promise<void> {
    if (this.closed) throw new LanError(503, '局域网共享已关闭')
    await this.stopping
    if (!this.options.active()) throw new LanError(503, '局域网共享未启用或本机账号未连接')
    if (this.server.port) return
    if (this.starting) return this.starting
    this.controller = new AbortController()
    const work = this.open(); this.starting = work
    try { await work } finally { if (this.starting === work) this.starting = undefined }
  }
  private async open() {
    await this.server.start()
    if (!this.active()) { await this.server.close(); return }
    if (this.options.discovery !== false) { this.discovery = new LanDiscovery(this.repository.device, this.server.port); await this.discovery.start() }
  }
  private addresses(): string[] {
    return this.options.host === '127.0.0.1' ? [`http://127.0.0.1:${this.server.port}`] : localAddresses(this.server.port)
  }
  private peerAddresses(peer: Peer): string[] {
    const discovered = this.discovery?.peers().find(value => value.deviceId === peer.deviceId && value.publicKey === peer.publicKey)?.address
    return [...new Set([...(discovered ? [discovered] : []), ...peer.addresses])]
  }
  network(): NetworkStatus {
    const found = this.discovery?.peers() ?? [], paired = this.repository.peers(), ids = [...new Set([...found.map(peer => peer.deviceId), ...paired.map(peer => peer.deviceId)])]
    return { deviceId: this.repository.device.deviceId, name: this.repository.device.name, addresses: this.addresses(), port: this.server.port, listening: this.active() && !!this.server.port,
      discoveryError: this.discovery?.error ?? null, peers: ids.map(id => {
        const peer = paired.find(value => value.deviceId === id), observed = found.find(value => value.deviceId === id && (!peer || value.publicKey === peer.publicKey))
        return { deviceId: id, name: peer?.name ?? observed?.name ?? '未知设备', addresses: peer ? this.peerAddresses(peer) : observed ? [observed.address] : [],
          paired: !!peer && !peer.revoked, discovered: !!observed, revoked: peer?.revoked ?? false, error: this.remote.failures.get(id) ?? null }
      }) }
  }
  invite() { return this.pairing.invite() }
  async pair(code: string, address?: string) { return this.pairing.join(code, address, this.server.port, this.controller.signal) }
  revoke(deviceId: string) { this.repository.revoke(deviceId) }
  async suspend() {
    this.controller.abort(new Error('局域网共享已暂停')); this.pairing.clear()
    const closing = this.stopping.catch(() => undefined).then(async () => {
      await this.starting?.catch(() => undefined); this.discovery?.close(); this.discovery = undefined; await this.server.close()
    })
    this.stopping = closing; await closing
  }
  async close() { if (this.closed) return; this.closed = true; await this.suspend(); this.repository.close() }
}
export async function createSharedLanRuntime(options: LanOptions): Promise<LanRuntime> {
  const runtime = new SharedLanRuntime(options)
  try { await runtime.start(); return runtime } catch (error) { await runtime.close(); throw error }
}

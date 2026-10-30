import path from 'node:path'
import { SnapshotStore } from '../client/snapshots.ts'
import { LanRepository } from './repository.ts'
import { LanLibraryService } from './library-service.ts'
import { identity } from './identity.ts'
import { LanDiscovery, localAddresses } from './discovery.ts'
import { LanHttpServer } from './wire.ts'
import { LanTransport } from './transport.ts'
import { LanPairing } from './pairing.ts'
import { DirectorySources } from './directory-sources.ts'
import { endpoint } from './validation.ts'
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
  private readonly sources: DirectorySources | undefined
  readonly remote: LanTransport
  private readonly options: LanOptions
  constructor(options: LanOptions) {
    this.options = options
    const root = path.join(options.dataRoot, 'lan')
    this.repository = new LanRepository(root, identity(root, options.name), options.administrators)
    this.sources = options.dedicated ? new DirectorySources(path.resolve(options.dataRoot), this.repository, () => this.active(),
      request => library.request(this.repository.device.deviceId, request)) : undefined
    const library = new LanLibraryService(this.repository, new SnapshotStore(root), () => this.active(), () => options.canPublish(),
      { dedicated: options.dedicated === true, invite: () => this.pairing.invite(), ...(this.sources ? { sources: this.sources } : {}) })
    this.remote = new LanTransport(this.repository, library, peer => this.peerAddresses(peer), () => this.controller.signal, options.connectionPosture)
    this.pairing = new LanPairing(this.repository, () => this.addresses(), () => this.active() && !!this.server.port, !options.dedicated)
    this.server = new LanHttpServer((route, body, source) => route.endsWith('/pair') ? this.pairing.accept(body, source) : this.remote.receive(body),
      () => this.active(), options.host, options.port, { allowRemote: options.dedicated === true, ...(options.tls ? { tls: options.tls } : {}) })
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
    await this.sources?.start()
    if (this.options.discovery !== false) { this.discovery = new LanDiscovery(this.repository.device, this.server.port); await this.discovery.start() }
  }
  private addresses(): string[] {
    if (this.options.publicAddresses?.length) return this.options.publicAddresses.map(value => endpoint(value, true))
    if (this.options.tls) return localAddresses(this.server.port).map(value => value.replace('http:', 'https:'))
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
  invite() {
    if (this.options.connectionPosture === 'cloud') throw new LanError(409, '云主机姿态需要选择已连接的云主机来创建邀请')
    return this.pairing.invite()
  }
  async pair(code: string, address?: string) {
    if (this.options.connectionPosture === 'cloud') throw new LanError(409, '请先切换到局域网姿态再配对局域网设备')
    const result = await this.pairing.join(code, address, this.server.port, this.controller.signal)
    if (this.options.connectionPosture) await this.hosts()
    return result
  }
  async connectHost(code: string, address?: string) {
    if (this.options.connectionPosture === 'lan') throw new LanError(409, '请先锁定云主机姿态再连接云主机')
    const result = await this.pairing.join(code, address, this.server.port, this.controller.signal, true)
    if (this.options.connectionPosture) await this.hosts()
    return result
  }
  hosts() { return this.remote.hosts(this.addresses()) }
  hostRequest<T>(deviceId: string, method: string, route: string, body?: unknown) { return this.remote.hostRequest<T>(deviceId, method, route, body) }
  deploymentIdentity() { const { deviceId, publicKey } = this.repository.device; return { deviceId, publicKey } }
  acceptsSpace(spaceId: string): boolean {
    const host = this.repository.host(spaceId)
    if (!host) return false
    if (!this.options.connectionPosture) return true
    if (host === this.repository.device.deviceId) return this.options.connectionPosture === 'lan'
    const peer = this.repository.peers().find(value => value.deviceId === host && !value.revoked)
    return !!peer && (peer.dedicated === true) === (this.options.connectionPosture === 'cloud')
  }
  revoke(deviceId: string) { this.repository.revoke(deviceId) }
  async suspend() {
    this.controller.abort(new Error('局域网共享已暂停')); this.pairing.clear()
    const closing = this.stopping.catch(() => undefined).then(async () => {
      await this.starting?.catch(() => undefined); this.discovery?.close(); this.discovery = undefined; await this.server.close(); await this.sources?.suspend()
    })
    this.stopping = closing; await closing
  }
  async close() { if (this.closed) return; this.closed = true; await this.suspend(); await this.sources?.close(); this.repository.close() }
}
export async function createSharedLanRuntime(options: LanOptions): Promise<LanRuntime> {
  const runtime = new SharedLanRuntime(options)
  try { await runtime.start(); return runtime } catch (error) { await runtime.close(); throw error }
}

import { randomUUID } from 'node:crypto'
import type { Remote } from '../client/contracts.ts'
import { MAX_FILE_BYTES } from '../client/contracts.ts'
import { LanError, type LibraryRequest, type LibraryResponse, type Peer, type Space, type SharedHost } from './contracts.ts'
import { LanRepository } from './repository.ts'
import { LanLibraryService } from './library-service.ts'
import { binary, integer, record, text, uuid } from './validation.ts'
import { open, seal } from './encryption.ts'
import { post } from './wire.ts'
import { digest } from './identity.ts'
import { sourceStatus } from './source-status.ts'

export class LanTransport implements Remote {
  readonly failures = new Map<string, string>()
  private readonly replay = new Map<string, number>()
  private readonly hostCache = new Map<string, SharedHost>()
  private readonly repository: LanRepository
  private readonly library: LanLibraryService
  private readonly addresses: (peer: Peer) => string[]
  private readonly signal: () => AbortSignal
  constructor(repository: LanRepository, library: LanLibraryService, addresses: (peer: Peer) => string[], signal: () => AbortSignal,
    private readonly posture?: 'lan' | 'cloud') {
    this.repository = repository; this.library = library; this.addresses = addresses; this.signal = signal
  }
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    this.library.assertActive(); this.signal().throwIfAborted()
    if (method === 'GET' && path === 'spaces') return { spaces: await this.spaces() } as T
    if (method === 'DELETE' && /^devices\//.test(path)) {
      this.assertHostPosture(this.repository.device.deviceId); this.assertHostPosture(uuid(path.slice(8)))
      this.repository.revoke(uuid(path.slice(8))); return { revoked: true } as T
    }
    const spaceId = /^spaces\/([^/?]+)/.exec(path)?.[1]
    const host = spaceId ? this.repository.host(uuid(spaceId)) : this.repository.device.deviceId
    if (!host) throw new LanError(404, '未找到资料库，请刷新或重新向发布设备申请权限')
    if (path !== 'capabilities') this.assertHostPosture(host)
    const request: LibraryRequest = { method, path, ...(body === undefined ? {} : { body }) }
    const result = host === this.repository.device.deviceId ? await this.library.request(host, request) : await this.send(this.repository.peer(host), request)
    return this.result(result) as T
  }
  async hostRequest<T>(hostDeviceId: string, method: string, path: string, body?: unknown): Promise<T> {
    this.library.assertActive(); this.signal().throwIfAborted()
    const id = uuid(hostDeviceId), request = { method, path, ...(body === undefined ? {} : { body }) }
    if (path !== 'capabilities') this.assertHostPosture(id)
    const response = id === this.repository.device.deviceId ? await this.library.request(id, request) : await this.send(this.repository.peer(id), request)
    const result = this.result(response) as T
    if (id !== this.repository.device.deviceId && method === 'POST' && path === 'spaces') {
      const peer = this.repository.peer(id), space = this.space(record(result).space, peer)
      this.repository.cache(peer, [...this.repository.cached().filter(value => value.hostDeviceId === id && value.id !== space.id), space])
    }
    return result
  }
  async hosts(addresses: string[]): Promise<{ hosts: SharedHost[] }> {
    const device = this.repository.device
    const own = record((await this.library.request(device.deviceId, { method: 'GET', path: 'capabilities' })).body)
    const hosts: SharedHost[] = this.posture === 'cloud' ? [] : [{ deviceId: device.deviceId, name: device.name, addresses, local: true, reachable: true,
      canPublish: own.canPublish === true, canManage: true, dedicated: own.dedicated === true, directorySources: own.directorySources === true, directoryCreate: own.directoryCreate === true, error: null }]
    const others = await Promise.all(this.repository.peers().filter(peer => !peer.revoked && this.addresses(peer).length
      && (!this.posture || peer.dedicated === undefined || this.matchesPosture(peer))).map(peer => this.probeHost(peer)))
    return { hosts: [...hosts, ...others.filter((host): host is SharedHost => host !== null)] }
  }
  private async probeHost(peer: Peer): Promise<SharedHost | null> {
      try {
        const info = record(await this.hostRequest(peer.deviceId, 'GET', 'capabilities'))
        if (info.protocolVersion !== 2) throw new LanError(400, '共享主机协议不兼容')
        if (peer.dedicated !== (info.dedicated === true)) this.repository.savePeer({ ...peer, dedicated: info.dedicated === true })
        if (this.posture && (info.dedicated === true) !== (this.posture === 'cloud')) return null
        const host: SharedHost = { deviceId: peer.deviceId, name: peer.name, addresses: this.addresses(peer), local: false, reachable: true,
          canPublish: info.canPublish === true, canManage: info.canManage === true, dedicated: info.dedicated === true, error: null }
        host.directorySources = info.directorySources === true
        host.directoryCreate = info.directoryCreate === true
        this.hostCache.set(peer.deviceId, host); return host
      } catch (error) {
        if (!this.matchesPosture(peer)) return null
        const previous = this.hostCache.get(peer.deviceId)
        return { deviceId: peer.deviceId, name: peer.name, addresses: this.addresses(peer), local: false,
          canPublish: previous?.canPublish ?? false, canManage: previous?.canManage ?? false, dedicated: previous?.dedicated ?? peer.dedicated ?? false,
          directorySources: previous?.directorySources ?? false, directoryCreate: previous?.directoryCreate ?? false, reachable: false, error: error instanceof Error ? error.message.slice(0, 200) : '主机暂时不可达' }
      }
  }
  private matchesPosture(peer: Peer): boolean { return !this.posture || (peer.dedicated === true) === (this.posture === 'cloud') }
  private assertHostPosture(id: string): void {
    if (!this.posture) return
    const matches = id === this.repository.device.deviceId ? this.posture === 'lan' : this.matchesPosture(this.repository.peer(id))
    if (!matches) throw new LanError(409, '目标资料库或主机不属于当前共享姿态，请切换姿态后操作')
  }
  async upload(spaceId: string, sha: string, bytes: Uint8Array) {
    if (bytes.length > MAX_FILE_BYTES || digest(bytes) !== sha) throw new LanError(400, '共享文件超限或校验失败')
    await this.request('PUT', `spaces/${spaceId}/blobs/${sha}`, { bytes: Buffer.from(bytes).toString('base64url') })
  }
  async download(spaceId: string, sha: string): Promise<Uint8Array> {
    const result = record(await this.request('GET', `spaces/${spaceId}/blobs/${sha}`)), bytes = binary(result.bytes)
    if (bytes.length > MAX_FILE_BYTES || digest(bytes) !== sha) throw new LanError(400, '远端内容校验失败')
    return bytes
  }
  async receive(value: unknown): Promise<unknown> {
    this.library.assertActive()
    const data = record(value), peer = this.repository.peer(uuid(data.deviceId)), requestId = uuid(data.requestId), timestamp = integer(data.timestamp)
    if (Math.abs(Date.now() - timestamp) > 60_000) throw new LanError(403, '请求时间失效，请检查设备时钟')
    const context = this.context(peer.deviceId, this.repository.device.deviceId, requestId, timestamp)
    const request = record(open(data.box, binary(peer.key, 32), `${context}:request`))
    const method = text(request.method, 10), path = text(request.path, 2000)
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new LanError(400, '无效共享请求方法')
    for (const [id, expires] of this.replay) if (expires < Date.now()) this.replay.delete(id)
    const replayKey = `${peer.deviceId}:${requestId}`
    if (this.replay.has(replayKey) || this.replay.size >= 10_000) throw new LanError(403, '重复或过量共享请求')
    this.replay.set(replayKey, Date.now() + 120_000)
    let result: LibraryResponse
    try { result = await this.library.request(peer.deviceId, { method, path, ...(request.body === undefined ? {} : { body: request.body }) }) }
    catch (error) {
      if (!(error instanceof LanError)) throw error
      result = { status: error.status, body: error.body }
    }
    this.library.assertActive(); this.repository.peer(peer.deviceId)
    return seal(result, binary(peer.key, 32), `${context}:response`)
  }
  private async send(peer: Peer, request: LibraryRequest): Promise<LibraryResponse> {
    const requestId = randomUUID(), timestamp = Date.now(), context = this.context(this.repository.device.deviceId, peer.deviceId, requestId, timestamp)
    const envelope = { deviceId: this.repository.device.deviceId, requestId, timestamp, box: seal(request, binary(peer.key, 32), `${context}:request`) }
    let error: unknown = new LanError(503, '发布设备离线，保留本地副本和待同步修改')
    for (const address of this.addresses(peer)) {
      try {
        const response = record(open(await post(address, '/eden-lan/v2/rpc', envelope, this.signal(), peer.allowRemote === true), binary(peer.key, 32), `${context}:response`))
        this.library.assertActive(); this.repository.peer(peer.deviceId)
        return { status: integer(response.status, 599), body: response.body }
      } catch (failure) { error = failure; if (this.signal().aborted || failure instanceof LanError && failure.status === 403) throw failure }
    }
    throw error
  }
  private async spaces(): Promise<Space[]> {
    if (this.posture && this.repository.peers().some(peer => !peer.revoked && peer.dedicated === undefined)) await this.hosts([])
    const own = (await this.library.request(this.repository.device.deviceId, { method: 'GET', path: 'spaces' })).body as { spaces: Space[] }
    const reachable = new Set<string>()
    await Promise.all(this.repository.peers().filter(peer => !peer.revoked && this.addresses(peer).length && this.matchesPosture(peer)).map(async peer => {
      try {
        const response = record(this.result(await this.send(peer, { method: 'GET', path: 'spaces' })))
        if (!Array.isArray(response.spaces) || response.spaces.length > 1000) throw new LanError(400, '无效资料库列表')
        const spaces = response.spaces.map(value => this.space(value, peer))
        this.repository.cache(peer, spaces); reachable.add(peer.deviceId); this.failures.delete(peer.deviceId)
      } catch (error) {
        this.signal().throwIfAborted(); this.library.assertActive()
        this.failures.set(peer.deviceId, error instanceof Error ? error.message.slice(0, 200) : '设备资料库暂不可达')
      }
    }))
    return [...own.spaces, ...this.repository.cached().filter(space => this.matchesPosture(this.repository.peer(space.hostDeviceId)))
      .map(space => ({ ...space, reachable: reachable.has(space.hostDeviceId) }))]
  }
  private space(value: unknown, peer: Peer): Space {
    const space = record(value)
    if ((space.role !== 'owner' && space.role !== 'editor' && space.role !== 'viewer') || space.hostDeviceId !== peer.deviceId)
      throw new LanError(400, '无效设备授权')
    return { id: uuid(space.id), name: text(space.name), role: space.role, hostDeviceId: peer.deviceId, hostName: peer.name,
      ...(space.source === undefined ? {} : { source: sourceStatus(space.source) }) }
  }
  private result(response: LibraryResponse): unknown {
    if (response.status >= 200 && response.status < 300) return response.body
    const body = record(response.body)
    throw new LanError(response.status, typeof body.error === 'string' ? body.error.slice(0, 200) : '设备共享请求失败', body as { error: string })
  }
  private context(from: string, to: string, id: string, timestamp: number) { return `rpc:${from}:${to}:${id}:${timestamp}` }
}

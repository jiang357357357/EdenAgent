import { SnapshotStore } from '../client/snapshots.ts'
import { MAX_FILE_BYTES } from '../client/contracts.ts'
import { LanRepository } from './repository.ts'
import { LanError, type LibraryRequest, type LibraryResponse } from './contracts.ts'
import { binary, commit, hash, integer, record, text, uuid } from './validation.ts'
import { digest } from './identity.ts'

export class LanLibraryService {
  readonly repository: LanRepository
  private readonly snapshots: SnapshotStore
  private readonly active: () => boolean
  private readonly canPublish: () => boolean
  constructor(repository: LanRepository, snapshots: SnapshotStore, active: () => boolean, canPublish: () => boolean) {
    this.repository = repository; this.snapshots = snapshots; this.active = active; this.canPublish = canPublish
  }
  assertActive() { if (!this.active()) throw new LanError(503, '局域网共享已关闭或本机账号已退出') }
  private assertPublishing() { this.assertActive(); if (!this.canPublish()) throw new LanError(403, '发布共享资料库需要启用共享资料库 DLC；接收资料无需 DLC') }
  async request(actor: string, request: LibraryRequest): Promise<LibraryResponse> {
    this.assertActive()
    const { method, path, body } = request
    const url = new URL(path, 'http://library/'), parts = url.pathname.split('/')
    if (url.origin !== 'http://library' || path.includes('..') || /%|\\/.test(path)) throw new LanError(400, '无效共享接口路径')
    const global = this.globalRequest(actor, method, path, body)
    if (global) return global
    if (parts[1] !== 'spaces' || !parts[2]) throw new LanError(404, '局域网共享接口不存在')
    this.assertPublishing()
    const id = uuid(parts[2]); this.repository.role(id, actor)
    return this.spaceRequest(actor, id, method, url, parts, body)
  }
  private globalRequest(actor: string, method: string, path: string, body: unknown): LibraryResponse | undefined {
    const local = actor === this.repository.device.deviceId
    if (path === 'capabilities' && method === 'GET') return this.ok({ protocolVersion: 2, maxFileBytes: MAX_FILE_BYTES, canPublish: this.canPublish() })
    if (path === 'spaces' && method === 'GET') return this.ok({ spaces: this.canPublish() ? this.repository.ownSpaces(actor) : [] })
    if (path === 'spaces' && method === 'POST' && local) { this.assertPublishing(); return this.ok({ space: this.repository.create(text(record(body).name)) }) }
    if (path === 'devices' && method === 'GET' && local) return this.ok({ devices: [
      { deviceId: this.repository.device.deviceId, name: this.repository.device.name, revoked: false, local: true },
      ...this.repository.peers().map(peer => ({ deviceId: peer.deviceId, name: peer.name, revoked: peer.revoked, local: false })),
    ] })
    return undefined
  }
  private async spaceRequest(actor: string, id: string, method: string, url: URL, parts: string[], body: unknown): Promise<LibraryResponse> {
    switch (parts[3]) {
      case 'members': return this.memberRequest(actor, id, method, body)
      case 'commit': if (method === 'POST') { this.repository.requireWrite(id, actor); return this.repository.commit(id, actor, commit(body)) } break
      case 'files': if (method === 'GET') return this.fileRequest(id, parts); break
      case 'changes':
        if (method === 'GET') return this.ok(this.repository.changes(id, integer(Number(url.searchParams.get('after') ?? 0)),
          Math.max(1, integer(Number(url.searchParams.get('limit') ?? 100), 100))))
        break
      case 'blobs': if (parts.length === 5) return this.blobRequest(actor, id, hash(parts[4]), method, body); break
    }
    throw new LanError(404, '局域网共享接口不存在')
  }
  private fileRequest(id: string, parts: string[]) {
    if (parts.length === 4) return this.ok({ files: this.repository.files(id) })
    if (parts[5] === 'history' && parts.length === 6) return this.ok({ versions: this.repository.history(id, uuid(parts[4])) })
    throw new LanError(404, '文件接口不存在')
  }
  private memberRequest(actor: string, id: string, method: string, body: unknown) {
    if (method !== 'GET') {
      if (this.repository.role(id, actor) !== 'owner') throw new LanError(403, '仅发布设备可以设置资料库权限')
      if (method !== 'PUT' && method !== 'DELETE') throw new LanError(405, '不支持的成员操作')
      const data = record(body), role = method === 'DELETE' ? null : data.role
      if (role !== null && role !== 'editor' && role !== 'viewer') throw new LanError(400, '无效设备权限')
      this.repository.setMember(id, actor, uuid(data.deviceId), role)
    }
    return this.ok({ members: this.repository.members(id, actor) })
  }
  private async blobRequest(actor: string, id: string, sha: string, method: string, body: unknown) {
    if (method === 'PUT') {
      this.repository.requireWrite(id, actor)
      const bytes = binary(record(body).bytes)
      if (bytes.length > MAX_FILE_BYTES || digest(bytes) !== sha) throw new LanError(400, '共享内容超过限制或校验失败')
      await this.snapshots.save(bytes)
      this.assertPublishing(); this.repository.saveBlob(id, actor, sha, bytes.length)
      return this.ok({ uploaded: true })
    }
    if (method !== 'GET') throw new LanError(405, '不支持的文件操作')
    if (this.repository.blob(id, sha) === null) throw new LanError(404, '内容不属于此资料库')
    const bytes = await this.snapshots.read(sha)
    this.assertPublishing(); this.repository.role(id, actor)
    return this.ok({ bytes: Buffer.from(bytes).toString('base64url') })
  }
  private ok(body: unknown): LibraryResponse { return { status: 200, body } }
}

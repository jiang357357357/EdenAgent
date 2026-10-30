import path from 'node:path'
import { realpathSync } from 'node:fs'
import { SharedWorkspaceClient } from '../client/shared-workspace-client.ts'
import type { Status } from '../client/contracts.ts'
import { LanError, type LibraryRequest, type LibraryResponse } from './contracts.ts'
import type { SourceBinding, SourceStatus } from './source-contracts.ts'
import { assertBoundDirectory, containsDirectory, directoryIdentity, listSourceDirectories } from './source-paths.ts'
import type { LanRepository } from './repository.ts'
import { createSourceDirectory } from './source-directories.ts'

type Request = (request: LibraryRequest) => Promise<LibraryResponse>

/** A cloud folder uses the same durable queue, snapshots and conflict rules as a receiving device. */
export class DirectorySources {
  private readonly clients = new Map<string, SharedWorkspaceClient>()
  private readonly opening = new Map<string, Promise<SharedWorkspaceClient>>()
  private readonly errors = new Map<string, string>()
  private timer: ReturnType<typeof setInterval> | undefined
  private closed = false
  constructor(private readonly root: string, private readonly repository: LanRepository,
    private readonly active: () => boolean, private readonly request: Request) { this.root = realpathSync(root) }

  browse(directory?: string, after?: string) { return listSourceDirectories(this.root, directory, after) }
  createDirectory(parent: string, name: string) { return createSourceDirectory(this.root, parent, name, target => this.assertIndependent(target)) }
  async create(name: string, directory: string) {
    const selected = await this.prepare(directory)
    const space = this.repository.createSource(name, selected)
    await this.sync(space.id)
    return { ...space, source: this.describe(space.id)! }
  }
  async prepare(directory: string) {
    const selected = await directoryIdentity(directory, this.root, true)
    this.assertIndependent(selected.path)
    return selected
  }
  private assertIndependent(directory: string) {
    if (this.repository.sourceBindings().some(binding => containsDirectory(binding.path, directory) || containsDirectory(directory, binding.path)))
      throw new LanError(409, '云端目录已由其他资料库共享，不能重复或交叉绑定')
  }
  async bind(spaceId: string, directory: string): Promise<SourceStatus> {
    const prior = this.repository.sourceBinding(spaceId)
    if (prior) {
      if (prior.path !== directory) throw new LanError(409, '资料库已绑定云端源目录；请创建新资料库以保留原有版本')
    } else {
      const selected = await this.prepare(directory)
      this.repository.bindSource({ spaceId, ...selected })
    }
    await this.sync(spaceId)
    return this.describe(spaceId)!
  }
  describe(spaceId: string): SourceStatus | undefined {
    const binding = this.repository.sourceBinding(spaceId)
    if (!binding) return undefined
    let status: Status | undefined, unavailable: string | null = null
    try { status = this.clients.get(spaceId)?.status() } catch (error) { unavailable = error instanceof Error ? error.message : '云端源目录不可用' }
    const error = unavailable ?? this.errors.get(spaceId) ?? status?.error ?? null
    return { path: binding.path, state: error ? 'offline' : status?.state === 'syncing' ? 'syncing' : status?.conflicts ? 'conflict' : 'idle',
      pending: status?.pending ?? 0, conflicts: status?.conflicts ?? 0, error }
  }
  async sync(spaceId: string) {
    const binding = this.repository.sourceBinding(spaceId)
    if (!binding) return
    try {
      const current = await directoryIdentity(binding.path, this.root, true)
      if (current.identity !== binding.identity) throw new Error('云端源目录身份已变化，请由管理员核对原目录')
      await (await this.open(binding)).sync()
      this.errors.delete(spaceId)
    } catch (error) { this.errors.set(spaceId, error instanceof Error ? error.message : '云端源目录不可用') }
  }
  assertAvailable(spaceId: string, writing = false) {
    const status = this.describe(spaceId)
    if (status?.error || (writing && status?.conflicts)) throw new LanError(503,
      status.conflicts ? '云端源目录存在冲突，请主机管理员先处理' : '云端源目录不可用，请主机管理员检查目录状态')
  }
  async conflicts(spaceId: string) { return { conflicts: (await this.required(spaceId)).conflicts() } }
  async resolve(spaceId: string, id: string, strategy: 'local' | 'remote') {
    await (await this.required(spaceId)).resolve(id, strategy)
    this.errors.delete(spaceId)
    return this.describe(spaceId)!
  }
  private required(spaceId: string) {
    const binding = this.repository.sourceBinding(spaceId)
    if (!binding) throw new LanError(409, '资料库尚未绑定云端源目录')
    return this.open(binding)
  }
  private open(binding: SourceBinding): Promise<SharedWorkspaceClient> {
    const ready = this.clients.get(binding.spaceId)
    if (ready) return Promise.resolve(ready)
    const pending = this.opening.get(binding.spaceId)
    if (pending) return pending
    const work = this.createClient(binding).finally(() => this.opening.delete(binding.spaceId))
    this.opening.set(binding.spaceId, work)
    return work
  }
  private async createClient(binding: SourceBinding) {
    let queue = Promise.resolve()
    const request = async <T>(method: string, route: string, body?: unknown): Promise<T> => {
      if (this.closed || !this.active()) throw new LanError(503, '云端目录同步已暂停')
      const response = await this.request({ method, path: route, ...(body === undefined ? {} : { body }) })
      if (response.status >= 400) throw new LanError(response.status, String((response.body as { error?: string }).error ?? '云端同步失败'), response.body as { error: string })
      return response.body as T
    }
    const client = new SharedWorkspaceClient({ dataRoot: path.join(this.root, 'directory-sources', binding.spaceId),
      workspace: () => {
        if (this.closed || !this.active()) throw new Error('云端目录同步已暂停')
        assertBoundDirectory(binding)
        return { root: binding.path, key: binding.spaceId }
      }, mutate: (_root, work) => {
        const task = queue.then(work)
        queue = task.then(() => undefined, () => undefined)
        return task
      }, remote: { request,
        upload: async (id, hash, bytes) => { await request('PUT', `spaces/${id}/blobs/${hash}`, { bytes: Buffer.from(bytes).toString('base64url') }) },
        download: async (id, hash) => Buffer.from((await request<{ bytes: string }>('GET', `spaces/${id}/blobs/${hash}`)).bytes, 'base64url'),
      } })
    try {
      if (!client.status().bound) await client.bind(binding.spaceId)
      if (client.status().spaceId !== binding.spaceId) throw new Error('云端目录同步记录与资料库不一致')
      this.clients.set(binding.spaceId, client)
      return client
    } catch (error) { await client.close(); throw error }
  }
  async start() {
    if (this.timer || this.closed) return
    const tick = () => Promise.all(this.repository.sourceBindings().map(binding => this.sync(binding.spaceId)))
    this.timer = setInterval(() => { void tick() }, 10000); this.timer.unref()
    await tick()
  }
  async suspend() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await Promise.allSettled([...this.opening.values()])
    await Promise.allSettled([...this.clients.values()].map(client => client.suspend()))
  }
  async close() { this.closed = true; await this.suspend(); await Promise.all([...this.clients.values()].map(client => client.close())) }
}

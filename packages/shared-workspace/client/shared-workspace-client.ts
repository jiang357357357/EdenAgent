import { randomUUID } from 'node:crypto'
import type { Binding, ClientOptions, Commit, Conflict, SharedFile, Status } from './contracts.ts'
import { fileRecord } from './contracts.ts'
import { SyncRepository } from './repository.ts'
import { SnapshotStore, applySnapshot, readSnapshot } from './snapshots.ts'
import { safeRelative, verifyRoot } from './paths.ts'
import { Synchronizer } from './synchronizer.ts'

export class SharedWorkspaceClient {
  private readonly options: ClientOptions
  private readonly repository: SyncRepository
  private readonly snapshots: SnapshotStore
  private readonly worker: Synchronizer
  private timer: ReturnType<typeof setInterval> | undefined
  private task: Promise<Status> | undefined
  private error: string | null = null
  private closed = false
  constructor(options: ClientOptions) {
    this.options = options
    this.repository = new SyncRepository(options.dataRoot)
    this.snapshots = new SnapshotStore(options.dataRoot)
    this.worker = new Synchronizer(options, this.repository, this.snapshots)
  }
  private binding(): Binding | null { return this.repository.binding(this.options.workspace().key) }
  private required(): Binding { const b = this.binding(); if (!b) throw new Error('当前工作区尚未加入共享资料库'); return b }
  private guard(binding: Binding, root: string) {
    if (this.closed) throw new Error('共享同步器已关闭')
    this.worker.assertScope(binding, root)
  }
  status(): Status {
    const { root } = this.options.workspace(), b = this.binding()
    const conflicts = b ? this.repository.conflicts(b.id).length : 0
    return { bound: !!b, spaceId: b?.spaceId ?? null, paused: b?.paused ?? false,
      state: !b ? 'unbound' : b.paused ? 'paused' : this.task ? 'syncing' : this.error ? 'offline' : conflicts ? 'conflict' : 'idle',
      pending: b ? this.repository.pending(b.id).length : 0, conflicts, lastSync: b?.lastSync ?? null, error: this.error, root }
  }
  async bind(spaceId: string): Promise<Status> {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(spaceId)) throw new Error('无效资料库 ID')
    const { root, key } = this.options.workspace()
    await verifyRoot(root)
    const result = await this.options.remote.request<{ spaces: { id: string }[] }>('GET', 'spaces')
    if (!result.spaces.some(s => s.id === spaceId)) throw new Error('没有该资料库的成员权限')
    if (this.options.workspace().key !== key || this.options.workspace().root !== root) throw new Error('工作区已切换，请重新确认共享范围')
    this.repository.bind(key, spaceId)
    this.error = null
    return this.status()
  }
  async pause(paused: boolean): Promise<Status> {
    this.repository.pause(this.required().id, paused)
    if (paused) await this.task
    return this.status()
  }
  files(): SharedFile[] { return this.repository.files(this.required().id) }
  conflicts(): Conflict[] { return this.repository.conflicts(this.required().id) }
  async sync(): Promise<Status> {
    if (this.closed) throw new Error('共享同步器已关闭')
    if (this.task) return this.task
    const b = this.binding()
    if (!b || b.paused) return this.status()
    const { root, key } = this.options.workspace()
    this.task = this.options.mutate(root, async () => {
      if (this.options.workspace().key !== key) throw new Error('工作区已切换')
      await verifyRoot(root)
      // Pull before scanning to recover acknowledged remote writes after a local crash.
      try { await this.worker.pull(b, root) }
      catch (error) {
        // Even while disconnected, capture durable local intent and its exact bytes.
        await this.worker.collect(b, root)
        throw error
      }
      await this.worker.collect(b, root)
      await this.worker.push(b, root)
      await this.worker.pull(this.repository.binding(key)!, root)
      // Editors can change files while a captured outbox version is in flight.
      await this.worker.collect(b, root)
      if (!this.repository.pending(b.id).length && !this.repository.conflicts(b.id).length) this.repository.synced(b.id)
      this.error = null
      return this.status()
    }).catch(error => { this.error = error instanceof Error ? error.message : '同步失败'; return this.status() })
    try { await this.task } finally { this.task = undefined }
    return this.status()
  }
  start(): void {
    if (this.closed || this.timer) return
    this.timer = setInterval(() => { void this.sync().catch(() => undefined) }, 10000)
    this.timer.unref()
    void this.sync().catch(() => undefined)
  }
  async suspend(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await this.task
  }
  async close(): Promise<void> { if (!this.closed) { this.closed = true; await this.suspend(); this.repository.close() } }
  async history(fileId: string): Promise<{ versions: SharedFile[] }> {
    const b = this.required()
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(fileId)) throw new Error('无效文件 ID')
    const result = await this.options.remote.request<{ versions: unknown[] }>('GET', `spaces/${b.spaceId}/files/${fileId}/history`)
    return { versions: result.versions.map(fileRecord) }
  }
  async resolve(conflictId: string, choice: 'local' | 'remote'): Promise<Status> {
    if (choice !== 'local' && choice !== 'remote') throw new Error('无效冲突处理方式')
    const b = this.required(), root = this.options.workspace().root
    if (this.task) await this.task
    this.guard(b, root)
    await this.options.mutate(root, async () => {
      this.guard(b, root)
      const conflict = this.repository.conflicts(b.id).find(c => c.id === conflictId)
      if (!conflict) throw new Error('冲突已处理或不存在')
      if (choice === 'local') await this.keepLocal(b, root, conflict)
      else await this.keepRemote(b, root, conflict)
      this.repository.removeConflict(conflict.id)
    })
    this.guard(b, root)
    this.error = null
    return this.sync()
  }
  private async keepLocal(b: Binding, root: string, conflict: Conflict) {
    const local = await readSnapshot(root, conflict.local.path)
    if (local) await this.snapshots.save(local.bytes)
    this.guard(b, root)
    const op: Commit = { operationId: randomUUID(), fileId: conflict.remote?.fileId ?? conflict.local.fileId,
      path: conflict.local.path, baseRevision: conflict.remote?.revision ?? 0,
      deleted: !local, sha256: local?.sha256 ?? null, size: local?.size ?? 0 }
    this.repository.transaction(() => {
      this.repository.acknowledge(b.id, conflict.local.fileId)
      if (conflict.remote) this.repository.file(b.id, conflict.remote)
      if (conflict.local.fileId !== op.fileId) this.repository.removeFile(b.id, conflict.local.fileId)
      this.repository.enqueue(b.id, op)
    })
  }
  private async keepRemote(b: Binding, root: string, conflict: Conflict) {
    if (!conflict.remote) throw new Error('远端版本不可用，请先重试同步')
    const file = fileRecord(conflict.remote)
    safeRelative(file.path)
    const local = await readSnapshot(root, file.path)
    if (local) await this.snapshots.save(local.bytes)
    await applySnapshot(root, file.path, local?.sha256 ?? null, await this.worker.content(b, file), () => this.guard(b, root))
    if (conflict.local.path !== file.path) {
      const displaced = await readSnapshot(root, conflict.local.path)
      if (displaced) { await this.snapshots.save(displaced.bytes); await applySnapshot(root, conflict.local.path, displaced.sha256, null, () => this.guard(b, root)) }
    }
    this.repository.transaction(() => {
      this.repository.acknowledge(b.id, conflict.local.fileId)
      if (conflict.local.fileId !== file.fileId) this.repository.removeFile(b.id, conflict.local.fileId)
      this.repository.file(b.id, file)
    })
  }
  async restore(fileId: string, revision: number): Promise<Status> {
    const b = this.required(), root = this.options.workspace().root
    if (this.task) await this.task
    this.guard(b, root)
    const historical = (await this.history(fileId)).versions.find(f => f.revision === revision)
    this.guard(b, root)
    if (!historical) throw new Error('历史版本不存在')
    const current = this.repository.files(b.id).find(f => f.fileId === fileId)
    if (!current) throw new Error('请先同步当前文件清单')
    if (this.repository.conflicts(b.id).some(c => c.local.fileId === fileId || c.remote?.fileId === fileId)
      || this.repository.pending(b.id).some(o => o.fileId === fileId)) throw new Error('请先处理该文件的待同步修改或冲突')
    await this.options.mutate(root, async () => {
      this.guard(b, root)
      const local = await readSnapshot(root, current.path)
      if ((local?.sha256 ?? null) !== current.sha256) throw new Error('本地文件有未同步修改，请先同步')
      await applySnapshot(root, current.path, local?.sha256 ?? null, await this.worker.content(b, historical), () => this.guard(b, root))
      this.repository.enqueue(b.id, { operationId: randomUUID(), fileId, path: current.path, baseRevision: current.revision,
        deleted: historical.deleted, sha256: historical.sha256, size: historical.size })
    })
    this.guard(b, root)
    return this.sync()
  }
}

export function createSharedWorkspaceClient(options: ClientOptions): SharedWorkspaceClient { return new SharedWorkspaceClient(options) }

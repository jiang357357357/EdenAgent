import { randomUUID } from 'node:crypto'
import type { Binding, ClientOptions, Commit, SharedFile } from './contracts.ts'
import { fileRecord, MAX_FILE_BYTES } from './contracts.ts'
import { SyncRepository } from './repository.ts'
import { SnapshotStore, applySnapshot, readSnapshot, scan, sha256 } from './snapshots.ts'
import { safeRelative } from './paths.ts'
import { collectChanges } from './collector.ts'

type LocalFile = Awaited<ReturnType<typeof readSnapshot>>
type Incoming = { file: SharedFile; prior: SharedFile | undefined; local: LocalFile; oldLocal: LocalFile }

export class Synchronizer {
  readonly options: ClientOptions
  readonly repository: SyncRepository
  readonly snapshots: SnapshotStore
  constructor(options: ClientOptions, repository: SyncRepository, snapshots: SnapshotStore) {
    this.options = options; this.repository = repository; this.snapshots = snapshots
  }
  assertScope(binding: Binding, root: string) {
    const current = this.options.workspace()
    if (current.key !== binding.workspaceKey || current.root !== root) throw new Error('工作区已切换，同步操作已停止')
  }
  async collect(binding: Binding, root: string) {
    this.assertScope(binding, root)
    const local = await scan(root, async item => { await this.snapshots.save(item.bytes) })
    this.assertScope(binding, root)
    collectChanges(this.repository, binding, local)
  }
  async push(binding: Binding, root: string) {
    for (const op of this.repository.pending(binding.id)) {
      try {
        this.assertScope(binding, root)
        if (op.sha256) await this.options.remote.upload(binding.spaceId, op.sha256, await this.snapshots.read(op.sha256))
        this.assertScope(binding, root)
        const result = await this.options.remote.request<{ file: SharedFile }>('POST', `spaces/${binding.spaceId}/commit`, op)
        const file = fileRecord(result.file)
        if (file.fileId !== op.fileId || file.path !== op.path || file.sha256 !== op.sha256 || file.deleted !== op.deleted) throw new Error('服务端提交结果与操作不一致')
        this.repository.transaction(() => { this.repository.file(binding.id, file); this.repository.acknowledge(binding.id, op.fileId) })
      } catch (error) {
        const failure = error as { status?: number; body?: { current?: unknown } }
        if (failure.status !== 409) throw error
        const current = failure.body?.current ? fileRecord(failure.body.current) : null
        this.repository.transaction(() => this.repository.conflict(binding.id, op, current))
      }
    }
  }
  async pull(binding: Binding, root: string) {
    let cursor = binding.cursor
    for (let page = 0; page < 100; page++) {
      this.assertScope(binding, root)
      const response = await this.options.remote.request<{ changes: { sequence: number; file: SharedFile }[]; cursor: number; hasMore: boolean }>(
        'GET', `spaces/${binding.spaceId}/changes?after=${cursor}&limit=100`)
      if (!Array.isArray(response.changes) || response.changes.length > 100 || !Number.isSafeInteger(response.cursor)
        || response.cursor < cursor || typeof response.hasMore !== 'boolean') throw new Error('无效共享变更分页')
      let previous = cursor
      for (const change of response.changes) {
        this.assertScope(binding, root)
        if (!Number.isSafeInteger(change.sequence) || change.sequence <= previous || change.sequence > response.cursor) throw new Error('无效共享变更序号')
        await this.receive(binding, root, fileRecord(change.file))
        this.repository.cursor(binding.id, change.sequence)
        previous = change.sequence
      }
      if (response.hasMore && response.cursor === cursor) throw new Error('共享变更游标没有前进')
      this.repository.cursor(binding.id, response.cursor)
      cursor = response.cursor
      if (!response.hasMore) return
    }
    throw new Error('变更过多，已保存进度，将在下次同步继续')
  }
  async content(binding: Binding, file: SharedFile): Promise<Uint8Array | null> {
    if (file.deleted) return null
    const bytes = await this.options.remote.download(binding.spaceId, file.sha256!)
    if (bytes.byteLength > MAX_FILE_BYTES || bytes.byteLength !== file.size || sha256(bytes) !== file.sha256) throw new Error('远端文件内容校验失败')
    await this.snapshots.save(bytes)
    return bytes
  }
  private async receive(binding: Binding, root: string, file: SharedFile) {
    this.assertScope(binding, root)
    safeRelative(file.path)
    const prior = this.repository.files(binding.id).find(f => f.fileId === file.fileId)
    if (prior && prior.revision >= file.revision) return
    const conflict = this.repository.conflicts(binding.id).find(c => c.local.fileId === file.fileId || c.remote?.fileId === file.fileId || c.path === file.path)
    if (conflict) { this.repository.conflict(binding.id, conflict.local, file); return }
    const local = await readSnapshot(root, file.path)
    const oldLocal = prior && prior.path !== file.path ? await readSnapshot(root, prior.path) : local
    const incoming = { file, prior, local, oldLocal }
    const alreadyApplied = this.alreadyApplied(incoming)
    const collided = this.repository.files(binding.id).find(f => f.fileId !== file.fileId && !f.deleted && f.path.toLowerCase() === file.path.toLowerCase())
    if (this.hasConflict(incoming, alreadyApplied, !!collided)) {
      await this.recordConflict(binding, incoming, collided)
      return
    }
    const guard = () => this.assertScope(binding, root)
    if (!alreadyApplied) await applySnapshot(root, file.path, local?.sha256 ?? null, await this.content(binding, file), guard)
    if (prior && prior.path !== file.path && oldLocal) await applySnapshot(root, prior.path, oldLocal.sha256, null, guard)
    this.repository.transaction(() => {
      this.repository.file(binding.id, file)
      if (alreadyApplied) {
        for (const pending of this.repository.pending(binding.id)) {
          if (pending.path === file.path) this.repository.acknowledge(binding.id, pending.fileId)
        }
      }
    })
  }
  // Recover a crash after a file replacement but before its metadata transaction.
  private alreadyApplied({ file, prior, local, oldLocal }: Incoming) {
    if (!file.deleted) return local?.sha256 === file.sha256
    return !local && (!prior || prior.path === file.path || !oldLocal)
  }
  private hasConflict({ file, prior, local, oldLocal }: Incoming, alreadyApplied: boolean, collided: boolean) {
    const expected = prior && !prior.deleted ? prior.sha256 : null
    const sourceChanged = prior && prior.path !== file.path && oldLocal && oldLocal.sha256 !== expected
    const destinationExists = prior?.path !== file.path && !!local
    return !!sourceChanged || (!alreadyApplied && ((oldLocal?.sha256 ?? null) !== expected || collided || destinationExists))
  }
  private async recordConflict(binding: Binding, { file, prior, local, oldLocal }: Incoming, collided: SharedFile | undefined) {
    const value = oldLocal ?? local
    if (value) await this.snapshots.save(value.bytes)
    const op: Commit = { operationId: randomUUID(), fileId: prior?.fileId ?? collided?.fileId ?? randomUUID(),
      path: value?.path ?? prior?.path ?? file.path, baseRevision: prior?.revision ?? 0,
      deleted: !value, sha256: value?.sha256 ?? null, size: value?.size ?? 0 }
    this.repository.conflict(binding.id, op, file)
  }

}

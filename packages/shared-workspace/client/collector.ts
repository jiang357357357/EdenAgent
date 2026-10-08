import { randomUUID } from 'node:crypto'
import type { Binding, SharedFile } from './contracts.ts'
import type { SyncRepository } from './repository.ts'

type LocalFile = { path: string; sha256: string; size: number }
type Collection = { tracked: SharedFile[]; pending: Set<string>; pendingPaths: Set<string>;
  blocked: Set<string | undefined>; blockedPaths: Set<string | undefined>; present: Set<string>; renamed: Set<string> }

function previousFile(item: LocalFile, state: Collection) {
  const prior = state.tracked.find(f => f.path === item.path && !f.deleted) ?? state.tracked.find(f => f.path === item.path)
  if (prior) return prior
  const candidates = state.tracked.filter(f => !f.deleted && f.sha256 === item.sha256 && !state.present.has(f.path)
    && !state.pending.has(f.fileId) && !state.blocked.has(f.fileId) && !state.renamed.has(f.fileId))
  if (candidates.length !== 1) return undefined
  state.renamed.add(candidates[0]!.fileId)
  return candidates[0]
}
function collectPresent(repository: SyncRepository, binding: Binding, item: LocalFile, state: Collection) {
  const previous = previousFile(item, state)
  if (state.pendingPaths.has(item.path) || state.blockedPaths.has(item.path)
    || (previous && (state.pending.has(previous.fileId) || state.blocked.has(previous.fileId)))) return
  if (previous && !previous.deleted && previous.path === item.path && previous.sha256 === item.sha256) return
  repository.enqueue(binding.id, { operationId: randomUUID(), fileId: previous?.fileId ?? randomUUID(), path: item.path,
    baseRevision: previous?.revision ?? 0, deleted: false, sha256: item.sha256, size: item.size })
}
export function collectChanges(repository: SyncRepository, binding: Binding, local: LocalFile[]) {
  const operations = repository.pending(binding.id), conflicts = repository.conflicts(binding.id)
  const state: Collection = { tracked: repository.files(binding.id), pending: new Set(operations.map(x => x.fileId)),
    pendingPaths: new Set(operations.map(x => x.path)),
    blocked: new Set(conflicts.flatMap(x => [x.local.fileId, x.remote?.fileId].filter(Boolean))),
    blockedPaths: new Set(conflicts.flatMap(x => [x.local.path, x.remote?.path].filter(Boolean))),
    present: new Set(local.map(f => f.path)), renamed: new Set() }
  for (const item of local) collectPresent(repository, binding, item, state)
  for (const file of state.tracked) {
    if (file.deleted || state.present.has(file.path) || state.renamed.has(file.fileId) || state.pending.has(file.fileId)
      || state.blocked.has(file.fileId) || state.blockedPaths.has(file.path)) continue
    repository.enqueue(binding.id, { operationId: randomUUID(), fileId: file.fileId, path: file.path,
      baseRevision: file.revision, deleted: true, sha256: null, size: 0 })
  }
}

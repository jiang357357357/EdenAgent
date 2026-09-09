import { open, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { EdenDatabase } from '@eden/store'
import { WorkspaceRepository } from './workspace-repository.ts'
import { workspaceRoot, workspaceFile } from './workspace-path.ts'
import { WorkspaceMutationQueue } from './mutation-queue.ts'

export class WorkspaceService {
  private readonly repository: WorkspaceRepository
  private readonly mutations = new WorkspaceMutationQueue()
  constructor(database: EdenDatabase, private readonly protectedRoots: readonly string[]) {
    this.repository = new WorkspaceRepository(database)
  }

  info() {
    const root = this.repository.read()
    return { name: root ? path.basename(root) : 'No workspace selected', path: root ?? '' }
  }

  root(): string {
    const saved = this.repository.read()
    if (!saved) throw new Error('Select a workspace first')
    const canonical = workspaceRoot(saved, this.protectedRoots)
    if (canonical !== saved) throw new Error('Workspace path changed; select it again')
    return canonical
  }

  switch(root: string) {
    const canonical = workspaceRoot(root, this.protectedRoots)
    this.repository.set(canonical)
    return { currentPath: canonical, pendingPath: null, pendingSessionId: null, requestedAt: null, updatedAt: Date.now() }
  }

  async mutate<T>(root: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    return this.mutations.run(signal, async () => {
      if (this.root() !== root) throw new Error('Workspace changed after permission request')
      return work()
    })
  }

  async list(requested: string) {
    const root = this.root()
    const filename = workspaceFile(root, requested)
    const entries = await readdir(filename, { withFileTypes: true })
    const visible = entries.filter(entry => entry.isFile() || entry.isDirectory())
    if (visible.length > 5000) throw new Error('Directory exceeds 5000 entries; choose a narrower directory')
    return { root, path: filename, entries: visible.map(entry => ({ name: entry.name, path: path.join(filename, entry.name), type: entry.isDirectory() ? 'directory' : 'file' })) }
  }

  async read(requested: string) {
    const root = this.root()
    const filename = workspaceFile(root, requested)
    const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await file.stat()
      if (!stat.isFile()) throw new Error('Workspace path is not a regular file')
      const buffer = Buffer.alloc(Math.min(stat.size, 1024 * 1024))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const content = buffer.subarray(0, bytesRead)
      const binary = content.includes(0)
      return { name: path.basename(filename), path: filename, size: stat.size, binary,
        truncated: stat.size > bytesRead, content: binary ? '' : content.toString('utf8'),
        sha256: stat.size === bytesRead ? createHash('sha256').update(content).digest('hex') : null }
    } finally { await file.close() }
  }
}

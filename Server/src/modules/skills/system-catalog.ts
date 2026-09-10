import { readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { readLocalSnapshot, type SkillSnapshot } from './snapshot.ts'

/** Administrator roots or current-workspace skill roots; never scan implicit home directories. */
export class SystemSkillCatalog {
  private snapshots: readonly SkillSnapshot[] = []
  private loadedRoots = ''
  constructor(private readonly roots: readonly string[] | (() => readonly string[]), private readonly project = false) { }
  private configuredRoots() { return typeof this.roots === 'function' ? this.roots() : this.roots }
  list() { return JSON.stringify(this.configuredRoots()) === this.loadedRoots ? this.snapshots : [] }
  async load(signal: AbortSignal) {
    const configuredRoots = this.configuredRoots(), identity = JSON.stringify(configuredRoots)
    const next: SkillSnapshot[] = [], names = new Set<string>(), roots = new Set<string>()
    for (const configured of configuredRoots) {
      signal.throwIfAborted()
      let root: string
      try { root = await realpath(configured) }
      catch (error) { if (this.project && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      if (this.project && root !== path.resolve(configured)) throw new Error('Project skill root cannot redirect outside its configured workspace path')
      if (roots.has(root)) continue
      roots.add(root)
      await collectRootSkills(root, signal, names, next)
    }
    signal.throwIfAborted()
    if (JSON.stringify(this.configuredRoots()) !== identity) throw new Error('Workspace changed during skill discovery; retry the refresh')
    this.snapshots = next
    this.loadedRoots = identity
  }
}

async function collectRootSkills(root: string, signal: AbortSignal, names: Set<string>, next: SkillSnapshot[]) {
  const entries = await readdir(root, { withFileTypes: true })
  if (entries.length > 512) throw new Error('System skill root exceeds 512 entries')
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    signal.throwIfAborted()
    if (entry.name.startsWith('.')) continue
    if (entry.isSymbolicLink()) throw new Error('System skill roots cannot contain redirected packages')
    if (!entry.isDirectory()) continue
    const data = await readLocalSnapshot(path.join(root, entry.name), '')
    if (names.has(data.name)) throw new Error(`Duplicate system skill name: ${data.name}`)
    names.add(data.name)
    next.push(data)
    if (next.length > 512 || next.reduce((sum, skill) => sum + skill.totalBytes, 0) > 64 * 1024 * 1024) throw new Error('System skill catalog exceeds its size limit')
  }
}

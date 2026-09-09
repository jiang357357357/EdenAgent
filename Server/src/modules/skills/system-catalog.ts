import { readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { readLocalSnapshot, type SkillSnapshot } from './snapshot.ts'

/** Explicit administrator roots only; never scan homes, data roots or process-wide skill defaults. */
export class SystemSkillCatalog {
  private snapshots: readonly SkillSnapshot[] = []
  constructor(private readonly roots: readonly string[]) {}
  list() { return this.snapshots }
  async load(signal: AbortSignal) {
    const next: SkillSnapshot[] = [], names = new Set<string>(), roots = new Set<string>()
    for (const configured of this.roots) {
      signal.throwIfAborted()
      const root = await realpath(configured)
      if (roots.has(root)) continue
      roots.add(root)
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
    signal.throwIfAborted()
    this.snapshots = next
  }
}

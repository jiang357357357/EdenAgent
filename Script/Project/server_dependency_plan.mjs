import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'

function locate(name, from, optional = false) {
  const require = createRequire(path.join(from, 'package.json'))
  for (const directory of require.resolve.paths(name) ?? []) {
    const candidate = path.join(directory, name, 'package.json')
    if (existsSync(candidate)) return path.dirname(realpathSync(candidate))
  }
  if (!optional) throw new Error(`Missing runtime dependency ${name} required by ${from}`)
}
const manifestAt = directory => JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
function dependencies(manifest) {
  const optional = manifest.optionalDependencies ?? {}
  const entries = Object.keys({ ...manifest.dependencies, ...optional }).map(name => [name, Object.hasOwn(optional, name)])
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    entries.push([name, manifest.peerDependenciesMeta?.[name]?.optional === true])
  }
  return entries
}

/** Resolve bundled workspace dependencies at the declared workspace, not the unrelated root hoist. */
export function serverDependencyPlan(root) {
  const placed = new Map()
  const queue = []
  const workspaces = new Set()
  function place(name, source, relative) {
    const existing = placed.get(relative)
    if (existing) {
      if (existing.source !== source) throw new Error(`Conflicting bundled dependency: ${name}`)
      return
    }
    const manifest = manifestAt(source)
    const entry = { name: manifest.name, version: manifest.version, source, relative }
    placed.set(relative, entry); queue.push(entry)
  }
  function workspace(name, from) {
    const source = locate(name, from)
    if (workspaces.has(source)) return
    workspaces.add(source)
    for (const [dependency, optional] of dependencies(manifestAt(source))) {
      if (dependency.startsWith('@eden/')) workspace(dependency, source)
      else {
        const resolved = locate(dependency, source, optional)
        if (resolved) place(dependency, resolved, dependency)
      }
    }
  }
  workspace('@eden/server', root)
  for (let index = 0; index < queue.length; index++) {
    const parent = queue[index]
    for (const [name, optional] of dependencies(manifestAt(parent.source))) {
      const source = locate(name, parent.source, optional)
      if (!source) continue
      // Search the destination ancestors using Node's node_modules lookup order.
      let cursor = parent.relative
      let visible
      while (cursor !== '.') {
        const candidate = placed.get(path.join(cursor, 'node_modules', name))
        if (candidate) { visible = candidate; break }
        cursor = path.dirname(cursor)
      }
      visible ??= placed.get(name)
      if (visible?.source === source) continue
      const relative = !placed.has(name) ? name : path.join(parent.relative, 'node_modules', name)
      place(name, source, relative)
    }
  }
  return [...placed.values()].sort((a, b) => a.relative.localeCompare(b.relative))
}

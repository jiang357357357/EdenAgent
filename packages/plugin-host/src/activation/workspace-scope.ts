import { realpathSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'

function overlaps(first: string, second: string): boolean {
  const relative = path.relative(first, second)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function workspaceScope(root: string, protectedRoots: readonly string[]): string {
  const canonical = realpathSync(root)
  if (!statSync(canonical).isDirectory()) throw new Error('Workspace grant must refer to a directory')
  for (const protectedRoot of protectedRoots) {
    const protectedPath = existsSync(protectedRoot) ? realpathSync(protectedRoot) : path.resolve(protectedRoot)
    if (overlaps(canonical, protectedPath) || overlaps(protectedPath, canonical)) throw new Error('Workspace overlaps protected runtime data')
  }
  return canonical
}

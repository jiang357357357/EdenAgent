import { realpathSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'

export function containsPath(root: string, filename: string): boolean {
  const relative = path.relative(root, filename)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function workspaceRoot(root: string, protectedRoots: readonly string[]): string {
  const canonical = realpathSync(root)
  if (!statSync(canonical).isDirectory()) throw new Error('Workspace must be a directory')
  for (const protectedRoot of protectedRoots) {
    const protectedPath = existsSync(protectedRoot) ? realpathSync(protectedRoot) : path.resolve(protectedRoot)
    if (containsPath(canonical, protectedPath) || containsPath(protectedPath, canonical)) throw new Error('Workspace overlaps private runtime data; choose a separate project directory')
  }
  return canonical
}

export function workspaceFile(root: string, requested: string): string {
  if (requested.includes('\0')) throw new Error('Invalid workspace path')
  const candidate = path.resolve(root, requested)
  if (!containsPath(root, candidate)) throw new Error('Path escapes the workspace')
  const canonical = realpathSync(candidate)
  if (!containsPath(root, canonical)) throw new Error('Symlink escapes the workspace')
  return canonical
}

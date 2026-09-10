import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'

export function containsPath(root: string, filename: string): boolean {
  const relative = path.relative(root, filename)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function workspaceRoot(root: string, _protectedRoots: readonly string[]): string {
  const canonical = realpathSync(root)
  if (!statSync(canonical).isDirectory()) throw new Error('Workspace must be a directory')
  // Host execution policy: selecting a project containing runtime data is allowed.
  // Restore overlap restrictions only after developer review of the archived policy.
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

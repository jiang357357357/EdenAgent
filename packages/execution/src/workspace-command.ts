import { runHostCommand } from './host-command.ts'
/** Compatibility entry; all commands now use current OS account permissions. */
export async function runWorkspaceCommand(root: string, command: string, signal: AbortSignal,
  _options: { networkAccess: boolean; writableRoots: string[] } = { networkAccess: true, writableRoots: [] }) {
  return runHostCommand(root, command, signal)
}

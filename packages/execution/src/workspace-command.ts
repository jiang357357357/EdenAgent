import { realpathSync } from 'node:fs'
import { runProcess } from './process-runner.ts'
import { sandboxArguments, sandboxExecutable } from './sandbox-arguments.ts'

export async function runWorkspaceCommand(root: string, command: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const args = [...sandboxArguments(), '--bind', realpathSync(root), '/workspace', '--chdir', '/workspace', '--',
    '/usr/bin/prlimit', '--as=1073741824:1073741824', '--cpu=30:30', '--nofile=256:256', '--fsize=16777216:16777216',
    '--', '/bin/sh', '-c', command]
  return runProcess({ executable: sandboxExecutable, args, input: '', timeoutMs: 30000, maxOutputBytes: 1024 * 1024, signal })
}

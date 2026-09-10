import { realpathSync, existsSync } from 'node:fs'
import { runProcess } from './process-runner.ts'
import { sandboxArguments, sandboxExecutable } from './sandbox-arguments.ts'

export async function runWorkspaceCommand(root: string, command: string, signal: AbortSignal, options: { networkAccess: boolean; writableRoots: string[] } = { networkAccess: false, writableRoots: [] }) {
  signal.throwIfAborted()
  const boundary = sandboxArguments()
  if (options.networkAccess) {
    boundary.push('--share-net', '--dir', '/etc')
    for (const filename of ['/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/ssl/certs']) {
      if (existsSync(filename)) boundary.push('--ro-bind', realpathSync(filename), filename)
    }
  }
  for (const directory of options.writableRoots) boundary.push('--bind', realpathSync(directory), directory)
  const args = [...boundary, '--bind', realpathSync(root), '/workspace', '--chdir', '/workspace', '--',
    '/usr/bin/prlimit', '--as=1073741824:1073741824', '--cpu=30:30', '--nofile=256:256', '--fsize=16777216:16777216',
    '--', '/bin/sh', '-c', command]
  return runProcess({ executable: sandboxExecutable, args, input: '', timeoutMs: 30000, maxOutputBytes: 1024 * 1024, signal })
}

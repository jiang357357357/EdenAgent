import { realpathSync, existsSync } from 'node:fs'

export const sandboxExecutable = '/usr/bin/bwrap'

export function sandboxArguments(): string[] {
  if (process.platform !== 'linux' || !existsSync(sandboxExecutable) || !existsSync('/usr/bin/prlimit')) throw new Error('OS sandbox unavailable; execution is disabled')
  const args = ['--unshare-all', '--die-with-parent', '--new-session', '--ro-bind', '/usr', '/usr',
    '--symlink', 'usr/bin', '/bin', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--dir', '/runtime', '--ro-bind', realpathSync(process.execPath), '/runtime/node',
    '--setenv', 'HOME', '/tmp', '--setenv', 'PATH', '/usr/bin:/bin']
  for (const directory of ['/lib', '/lib64']) if (existsSync(directory)) args.push('--ro-bind', realpathSync(directory), directory)
  return args
}

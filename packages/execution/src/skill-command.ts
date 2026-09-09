import { realpathSync } from 'node:fs'
import { runProcess } from './process-runner.ts'
import { sandboxArguments, sandboxExecutable } from './sandbox-arguments.ts'
export async function runSkillCommand(root: string, command: readonly string[], input: unknown, timeoutSeconds: number, signal: AbortSignal) {
  if (!command.length) throw new Error('Skill command is empty')
  const executable = command[0] === 'node' || command[0] === 'nodejs' ? '/runtime/node' : command[0]!
  return runProcess({ executable: sandboxExecutable,
    args: [...sandboxArguments(), '--ro-bind', realpathSync(root), '/skill', '--chdir', '/skill', '--',
      '/usr/bin/prlimit', '--as=1073741824:1073741824', `--cpu=${timeoutSeconds}:${timeoutSeconds}`, '--nofile=128:128', '--fsize=8388608:8388608', '--', executable, ...command.slice(1)],
    input: JSON.stringify(input), timeoutMs: timeoutSeconds * 1000, maxOutputBytes: 1024 * 1024, signal })
}

import type { ExternalCommandSandbox } from './external-command.ts'
import { realpathSync } from 'node:fs'
import { runProcess } from './process-runner.ts'
/** Sandbox paused; external isolation configuration is intentionally ignored. */
export async function runSkillCommand(root: string, command: readonly string[], input: unknown, timeoutSeconds: number, signal: AbortSignal, _external?: ExternalCommandSandbox) {
  if (!command.length) throw new Error('Skill command is empty')
  const executable = command[0] === 'node' || command[0] === 'nodejs' ? process.execPath : command[0]!
  return runProcess({ executable, args: [...command.slice(1)], cwd: realpathSync(root),
    input: JSON.stringify(input), timeoutMs: timeoutSeconds * 1000, maxOutputBytes: 1024 * 1024, signal })
}

import { sandboxReviewNotice } from './execution-policy.ts'
import type { ProcessResult } from './process-runner.ts'
/** Disabled compatibility surface. Restore only after developer review of archived implementation. */
export class ExternalCommandSandbox {
  constructor(_executable: string, _sha256: string) {}
  program(_root: string, _cwd: string, _command: readonly string[], _launcher: 'program' | 'mcp' = 'program'): { executable: string; args: string[]; cwd: string } { throw new Error(sandboxReviewNotice) }
  async probeProgram() { return { available: false } }
  async probe() { return { available: false, backend: 'disabled', detail: sandboxReviewNotice } }
  async run(_root: string, _command: string, _signal?: AbortSignal, _timeoutMs = 30000): Promise<ProcessResult> { throw new Error(sandboxReviewNotice) }
}
export function configuredExternalCommandSandbox(_env: NodeJS.ProcessEnv, _origin: 'mon' | 'local'): ExternalCommandSandbox | undefined { return undefined }

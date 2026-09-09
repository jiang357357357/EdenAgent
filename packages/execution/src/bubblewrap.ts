import { realpathSync } from 'node:fs'
import { runProcess } from './process-runner.ts'
import type { ProcessResult } from './process-runner.ts'

import { sandboxArguments as baseArguments, sandboxExecutable as executable } from './sandbox-arguments.ts'
const boundedNode = ['/usr/bin/prlimit', '--as=1073741824:1073741824', '--cpu=5:5', '--nofile=64:64', '--fsize=8388608:8388608', '--',
  '/runtime/node', '--disable-wasm-trap-handler', '--max-old-space-size=64', '--permission',
  '--allow-fs-read=/plugin', '--allow-fs-read=/workspace', '--allow-fs-write=/tmp', '--no-addons']
const runner = `import run from '/plugin/index.mjs';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const result = await run(JSON.parse(input), Object.freeze({ workspaceRoot: '/workspace' }));
process.stdout.write(JSON.stringify({ result }) + '\\n');`

export interface IsolatedModuleRequest {
  moduleRoot: string
  readRoot?: string
  input: unknown
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  /** Only trusted workspace tools may request this; plugin host never forwards it. */
  writableWorkspace?: boolean
}

export async function probeSandbox(): Promise<{ available: boolean; backend: string; detail: string }> {
  try {
    const result = await runProcess({ executable, args: [...baseArguments(), '--dir', '/plugin', '--dir', '/workspace', '--', ...boundedNode, '-e', 'process.stdout.write("eden-sandbox-ok")'],
      input: '', timeoutMs: 3000, maxOutputBytes: 16384 })
    if (result.exitCode !== 0 || result.stdout !== 'eden-sandbox-ok') throw new Error(result.stderr || 'sandbox probe did not complete')
    return { available: true, backend: 'bubblewrap', detail: 'OS namespace startup probe passed' }
  } catch (error) {
    return { available: false, backend: 'unavailable', detail: error instanceof Error ? error.message : 'Sandbox probe failed' }
  }
}

export async function runIsolatedModule(request: IsolatedModuleRequest): Promise<ProcessResult> {
  const args = baseArguments()
  args.push('--ro-bind', realpathSync(request.moduleRoot), '/plugin')
  if (request.readRoot) args.push(request.writableWorkspace ? '--bind' : '--ro-bind', realpathSync(request.readRoot), '/workspace')
  else args.push('--dir', '/workspace')
  args.push('--chdir', '/plugin', '--', ...boundedNode, ...(request.writableWorkspace ? ['--allow-fs-write=/workspace'] : []), '--input-type=module', '-e', runner)
  return runProcess({ executable, args, input: JSON.stringify(request.input),
    timeoutMs: request.timeoutMs ?? 5000, maxOutputBytes: request.maxOutputBytes ?? 1024 * 1024,
    ...(request.signal ? { signal: request.signal } : {}) })
}

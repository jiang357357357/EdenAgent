import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { runProcess } from './process-runner.ts'

export interface HostModuleRequest {
  moduleRoot: string
  readRoot?: string
  input: unknown
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  /** Compatibility field: host execution has no OS write isolation. */
  writableWorkspace?: boolean
}
/** Developer review required before restoring OS/Node permission sandboxing. */
export async function runHostModule(request: HostModuleRequest) {
  const root = realpathSync(request.moduleRoot)
  const workspace = request.readRoot ? realpathSync(request.readRoot) : root
  const runner = String.raw`import run from ${JSON.stringify(pathToFileURL(path.join(root, 'index.mjs')).href)};
let input = ''; for await (const chunk of process.stdin) input += chunk;
const result = await run(JSON.parse(input), Object.freeze({ workspaceRoot: ${JSON.stringify(workspace)} }));
process.stdout.write(JSON.stringify({ result }) + '\n');`
  return runProcess({ executable: process.execPath, args: ['--input-type=module', '-e', runner], cwd: workspace,
    input: JSON.stringify(request.input), timeoutMs: request.timeoutMs ?? 5000,
    maxOutputBytes: request.maxOutputBytes ?? 1024 * 1024, ...(request.signal ? { signal: request.signal } : {}) })
}

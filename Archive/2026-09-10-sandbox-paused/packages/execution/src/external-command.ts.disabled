import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runProcess } from './process-runner.ts'
import { windowsHostTools } from './windows-process.ts'

/** Administrator-supplied isolation adapter. Never configurable by a model or plugin. */
export class ExternalCommandSandbox {
  constructor(private readonly executable: string, private readonly sha256: string) {
    if (!path.isAbsolute(executable) || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('External sandbox requires an absolute executable and pinned SHA256')
  }
  private checkedExecutable() {
    const info = lstatSync(this.executable)
    if (!info.isFile() || info.size > 128 * 1024 * 1024 || realpathSync(this.executable) !== this.executable) throw new Error('External sandbox must be a bounded regular executable without path redirection')
    if (createHash('sha256').update(readFileSync(this.executable)).digest('hex') !== this.sha256) throw new Error('External sandbox executable changed; administrator confirmation is required')
    return this.executable
  }
  program(root: string, cwd: string, command: readonly string[], launcher: 'program' | 'mcp' = 'program') {
    const executable = this.checkedExecutable(), workspace = realpathSync(root), working = realpathSync(cwd)
    const relative = path.relative(workspace, working)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('External sandbox working directory escapes snapshot')
    if (!command.length || !command[0] || command.some(value => value.includes('\0'))) throw new Error('Invalid sandbox program arguments')
    const program = command[0] === 'node' || command[0] === 'nodejs' ? process.execPath : command[0]
    return { executable, args: ['--workspace', workspace, '--cwd', working, '--launcher', launcher, '--', program, ...command.slice(1)], cwd: working }
  }
  async probeProgram() {
    let root
    try {
      root = await mkdtemp(path.join(os.tmpdir(), 'eden-external-program-'))
      const result = await runProcess({ ...this.program(root, root, ['node', '-e', 'process.exit(0)']), input: '', timeoutMs: 5000, maxOutputBytes: 1024 })
      return { available: result.exitCode === 0 }
    } catch { return { available: false } }
    finally { if (root) await rm(root, { recursive: true, force: true }) }
  }
  async probe() {
    let root
    try {
      root = await mkdtemp(path.join(os.tmpdir(), 'eden-external-sandbox-'))
      const result = await this.run(root, 'exit 0', undefined, 5000)
      if (result.exitCode !== 0) throw new Error('External sandbox startup did not succeed')
      return { available: true, backend: 'external', detail: 'Administrator-configured isolation adapter startup passed; its filesystem/network enforcement is provided by that adapter.' }
    } catch (error) { return { available: false, backend: 'external', detail: error instanceof Error ? error.message : 'External sandbox unavailable' } }
    finally { if (root) await rm(root, { recursive: true, force: true }) }
  }
  run(root: string, command: string, signal?: AbortSignal, timeoutMs = 30000) {
    const executable = this.checkedExecutable(), workspace = realpathSync(root)
    const windows = process.platform === 'win32', shell = windows ? windowsHostTools().shell : '/bin/bash'
    const args = windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(`[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n${command}`, 'utf16le').toString('base64')] : ['--noprofile', '--norc', '-c', command]
    return runProcess({ executable, args: ['--workspace', workspace, '--cwd', workspace, '--launcher', windows ? 'powershell' : 'bash', '--', shell, ...args],
      cwd: workspace, input: '', timeoutMs, maxOutputBytes: 1024 * 1024, ...(signal ? { signal } : {}) })
  }
}
export function configuredExternalCommandSandbox(env: NodeJS.ProcessEnv, origin: 'mon' | 'local') {
  const scoped = `EDEN_AGENT_${origin.toUpperCase()}_EXTERNAL_SANDBOX`
  const prefix = env[scoped] !== undefined || env[`${scoped}_SHA256`] !== undefined ? scoped : 'EDEN_AGENT_EXTERNAL_SANDBOX'
  const executable = env[prefix], hash = env[`${prefix}_SHA256`]
  if (executable === undefined && hash === undefined) return undefined
  if (!executable || !hash) throw new Error('Configure both external sandbox executable and SHA256')
  return new ExternalCommandSandbox(executable, hash)
}

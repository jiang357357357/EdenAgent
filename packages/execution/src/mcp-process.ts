import type { ExternalCommandSandbox } from './external-command.ts'
import { stopWindowsProcessTree } from './windows-process.ts'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hostProcessEnvironment } from './host-environment.ts'

/** Receives the verified package snapshot, never a mutable source directory or inherited environment. */
export async function launchMcpProcess(files: ReadonlyMap<string, Buffer>, descriptor: { command: string; args: string[]; cwd: string }, signal: AbortSignal, _external?: ExternalCommandSandbox) {
  signal.throwIfAborted()
  if (files.size > 4096) throw new Error('MCP package contains too many files')
  const directory = await mkdtemp(path.join(tmpdir(), 'eden-mcp-'))
  try {
    await writeMcpSnapshot(files, signal, directory)
    const { cwd, command } = mcpInvocationPaths(descriptor, directory)
    signal.throwIfAborted()
    const hostPath = (value: string) => value === '/package' ? directory : value.startsWith('/package/') ? path.join(directory, value.slice('/package/'.length)) : value
    const invocation = { executable: command === '/runtime/node' ? process.execPath : hostPath(command), args: descriptor.args.map(hostPath) }
    const child = spawn(invocation.executable, invocation.args, {
      cwd: hostPath(cwd), detached: process.platform !== 'win32', windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'], env: hostProcessEnvironment()
    })
    let ended = false, logged = 0
    let termination: Promise<void> | undefined
    const kill = () => {
      if (ended || !child.pid) return
      if (process.platform === 'win32') {
        termination ??= stopWindowsProcessTree(child.pid).catch(() => {
          child.kill('SIGKILL')
          throw new Error('MCP process-tree termination was not confirmed')
        }).finally(() => { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy() })
        void termination.catch(() => { })
      } else { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    }
    const exited = new Promise<void>(resolve => child.once('close', () => { ended = true; signal.removeEventListener('abort', kill); resolve() }))
      .then(async () => { await termination; await rm(directory, { recursive: true, force: true }) })
    void exited.catch(() => { process.stderr.write('MCP snapshot cleanup failed\n') })
    child.stderr.on('data', (chunk: Buffer) => { logged += chunk.length; if (logged > 1024 * 1024) kill() })
    child.stdin.on('error', kill)
    signal.addEventListener('abort', kill, { once: true })
    try {
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('MCP host process launch failed'))) })
      signal.throwIfAborted()
    } catch (error) { kill(); await exited; throw error }
    return { input: child.stdin, output: child.stdout, terminate: kill, exited, async close() { kill(); await exited } }
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
}
function mcpInvocationPaths(descriptor: { command: string; args: string[]; cwd: string }, directory: string) {
  const cwd = descriptor.cwd === '.' ? '/package' : packagePath(descriptor.cwd)
  const value = descriptor.command
  if (!value || value.includes('\0')) throw new Error('Invalid MCP command')
  const command = value === 'node' || value === 'nodejs' ? '/runtime/node'
    : path.isAbsolute(value) ? value
    : value.includes('/') || value.includes('\\') || existsSync(path.join(directory, value)) ? packagePath(value.replace(/^\.\//, '')) : value
  if (descriptor.args.length > 128 || descriptor.args.some(value => value.length > 8192 || value.includes('\0'))) throw new Error('Invalid MCP arguments')
  return { cwd, command }
}

async function writeMcpSnapshot(files: ReadonlyMap<string, Buffer<ArrayBufferLike>>, signal: AbortSignal, directory: string) {
  let bytes = 0
  for (const [name, content] of files) {
    if (!name || name.startsWith('/') || /[\\:\x00-\x1f]/.test(name) || name.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('MCP package contains an invalid path')
    bytes += content.length
    if (bytes > 128 * 1024 * 1024) throw new Error('MCP package exceeds snapshot limit')
    signal.throwIfAborted()
    const file = path.join(directory, name)
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    await writeFile(file, content, { flag: 'wx', mode: 0o500 })
  }
}

function packagePath(value: string) {
  if (!value || value.startsWith('/') || /[\\:\x00-\x1f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('MCP path escapes package')
  return `/package/${value}`
}

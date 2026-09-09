import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sandboxArguments, sandboxExecutable } from './sandbox-arguments.ts'

/** Receives the verified package snapshot, never a mutable source directory or inherited environment. */
export async function launchMcpProcess(files: ReadonlyMap<string, Buffer>, descriptor: { command: string; args: string[]; cwd: string }, signal: AbortSignal) {
  signal.throwIfAborted()
  const args = sandboxArguments()
  if (files.size > 4096) throw new Error('MCP package contains too many files')
  const directory = await mkdtemp(path.join(tmpdir(), 'eden-mcp-'))
  try {
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
    const cwd = descriptor.cwd === '.' ? '/package' : packagePath(descriptor.cwd)
    const command = descriptor.command === 'node' || descriptor.command === 'nodejs' ? '/runtime/node'
      : descriptor.command.startsWith('/') ? descriptor.command : packagePath(descriptor.command.replace(/^\.\//, ''))
    if (!command.startsWith('/package/') && command !== '/runtime/node' && !/^\/usr\/bin\/[a-zA-Z0-9._+-]+$/.test(command)) throw new Error('MCP executable must be bundled, Node, or a sandbox system executable')
    if (descriptor.args.length > 128 || descriptor.args.some(value => value.length > 8192 || value.includes('\0'))) throw new Error('Invalid MCP arguments')
    args.push('--ro-bind', directory, '/package', '--chdir', cwd, '--', '/usr/bin/prlimit', '--as=1073741824:1073741824', '--nofile=128:128', '--fsize=8388608:8388608', '--', command, ...descriptor.args)
    signal.throwIfAborted()
    const child = spawn(sandboxExecutable, args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } })
    let ended = false, logged = 0
    const kill = () => {
      if (ended || !child.pid) return
      try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }
    const exited = new Promise<void>(resolve => child.once('close', () => { ended = true; signal.removeEventListener('abort', kill); resolve() }))
      .then(() => rm(directory, { recursive: true, force: true }))
    void exited.catch(() => { process.stderr.write('MCP snapshot cleanup failed\n') })
    child.stderr.on('data', (chunk: Buffer) => { logged += chunk.length; if (logged > 1024 * 1024) kill() })
    child.stdin.on('error', kill)
    signal.addEventListener('abort', kill, { once: true })
    try {
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('MCP sandbox launch failed'))) })
      signal.throwIfAborted()
    } catch (error) { kill(); await exited; throw error }
    return { input: child.stdin, output: child.stdout, terminate: kill, exited, async close() { kill(); await exited } }
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
}
function packagePath(value: string) {
  if (!value || value.startsWith('/') || /[\\:\x00-\x1f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('MCP path escapes package')
  return `/package/${value}`
}

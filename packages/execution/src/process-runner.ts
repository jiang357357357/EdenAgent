import { stopWindowsProcessTree } from './windows-process.ts'
import { hostProcessEnvironment } from './host-environment.ts'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

export interface ProcessResult { stdout: string; stderr: string; exitCode: number }
export interface ProcessRequest {
  env?: NodeJS.ProcessEnv
  cwd?: string
  executable: string
  args: string[]
  input: string
  timeoutMs: number
  maxOutputBytes: number
  signal?: AbortSignal
}

export function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  request.signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(request.executable, request.args, {
      ...(request.cwd ? { cwd: request.cwd } : {}),
      env: request.env ?? hostProcessEnvironment(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    let stdout = ''
    let stderr = ''
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
    let bytes = 0
    let failure: Error | undefined
    let termination: Promise<void> | undefined
    const stop = (reason: Error) => {
      failure ??= reason
      if (!child.pid) return
      if (process.platform === 'win32') {
        termination ??= stopWindowsProcessTree(child.pid).catch(() => {
          failure = new Error('Windows process-tree stop was not confirmed; inspect remaining processes before retrying')
          child.kill('SIGKILL')
        }).finally(() => { child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy() })
      }
      else {
        try { process.kill(-child.pid, 'SIGKILL') }
        catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) child.kill('SIGKILL') }
      }
    }
    const timer = setTimeout(() => stop(new Error('Process time limit exceeded')), request.timeoutMs)
    const abort = () => stop(new Error('Process cancelled'))
    request.signal?.addEventListener('abort', abort, { once: true })
    if (request.signal?.aborted) abort()
    const collect = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      bytes += chunk.byteLength
      if (bytes > request.maxOutputBytes) { stop(new Error('Process output limit exceeded')); return }
      if (target === 'stdout') stdout += decoders.stdout.write(chunk)
      else stderr += decoders.stderr.write(chunk)
    }
    child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk))
    child.stdin.on('error', error => { if (!('code' in error && error.code === 'EPIPE')) stop(error) })
    child.on('error', error => { failure ??= error })
    child.once('close', async code => {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', abort)
      await termination
      if (failure) reject(Object.assign(failure, { toolOutcome: child.pid ? 'unknown' : 'failed' }))
      else resolve({ stdout: stdout + decoders.stdout.end(), stderr: stderr + decoders.stderr.end(), exitCode: code ?? -1 })
    })
    child.stdin.end(request.input)
  })
}

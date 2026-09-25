import { existsSync } from 'node:fs'
import { runProcess } from './process-runner.ts'
import { windowsHostTools } from './windows-process.ts'

export function hostCommandInfo() {
  if (process.platform === 'win32') { const tools = windowsHostTools(); return { shell: tools.shell, available: tools.available } }
  return { shell: '/bin/sh', available: existsSync('/bin/sh') }
}
export function runHostCommand(root: string, command: string, signal: AbortSignal, timeoutMs = 30000) {
  const host = hostCommandInfo()
  if (!host.available) throw new Error('Host command execution tools are unavailable')
  const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(`[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\n$OutputEncoding = [Console]::OutputEncoding\n${command}`, 'utf16le').toString('base64')] : ['-c', command]
  return runProcess({ executable: host.shell, args, cwd: root, input: '', timeoutMs, maxOutputBytes: 1024 * 1024,
    truncateOutput: true, signal })
}

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { runProcess } from './process-runner.ts'
import { windowsProcessEnvironment } from './windows-process.ts'

function wslExecutable(): string {
  const root = windowsProcessEnvironment().SystemRoot!
  return path.win32.join(root, 'System32', 'wsl.exe')
}

/** WSL's list output is UTF-16LE on some Windows releases. */
export async function listWslDistributions(): Promise<string[]> {
  if (process.platform !== 'win32' || !existsSync(wslExecutable())) return []
  const output = await new Promise<Buffer>((resolve, reject) => {
    execFile(wslExecutable(), ['--list', '--quiet'], {
      encoding: 'buffer', timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true,
      env: windowsProcessEnvironment(),
    }, (error, stdout) => error ? reject(error) : resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)))
  }).catch(() => null)
  if (!output) return []
  const utf16 = (output[0] === 0xff && output[1] === 0xfe) || (output.length > 3 && output[1] === 0 && output[3] === 0)
  const decoded = output.toString(utf16 ? 'utf16le' : 'utf8').replaceAll('\u0000', '').replace(/^\ufeff/, '')
  return [...new Set(decoded.split(/\r?\n/).map(value => value.trim()).filter(Boolean))]
}

/** WSL is an alternate local shell, not an Eden sandbox. */
export async function runWslCommand(root: string, command: string, distribution: string, signal: AbortSignal, timeoutMs = 30000) {
  if (process.platform !== 'win32') throw new Error('WSL terminal is available only on Windows')
  if (!(await listWslDistributions()).includes(distribution)) throw new Error(`WSL distribution is unavailable: ${distribution}`)
  // wslpath resolves the selected Windows workspace according to this distribution's mount configuration.
  const script = 'target=$(wslpath -u "$1") || exit; cd "$target" || exit; exec /bin/sh -s'
  return runProcess({
    executable: wslExecutable(),
    args: ['--distribution', distribution, '--exec', '/bin/sh', '-c', script, 'eden-agent', root],
    cwd: root, input: command, timeoutMs, maxOutputBytes: 1024 * 1024, truncateOutput: true, signal,
  })
}

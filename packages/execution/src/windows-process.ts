import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

export function windowsProcessEnvironment(): NodeJS.ProcessEnv {
  const root = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows'
  if (!path.win32.isAbsolute(root)) throw new Error('Windows system root must be absolute')
  const system = path.win32.join(root, 'System32')
  return { SystemRoot: root, WINDIR: root, PATH: `${system};${root};${path.win32.join(system, 'WindowsPowerShell', 'v1.0')}`,
    ...(process.env.TEMP ? { TEMP: process.env.TEMP } : {}), ...(process.env.TMP ? { TMP: process.env.TMP } : {}) }
}
export function windowsHostTools() {
  const environment = windowsProcessEnvironment(), root = environment.SystemRoot!
  const shell = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const taskkill = path.win32.join(root, 'System32', 'taskkill.exe')
  return { shell, taskkill, environment, available: process.platform === 'win32' && existsSync(shell) && existsSync(taskkill) }
}
export function stopWindowsProcessTree(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return Promise.reject(new Error('Invalid process identity for termination'))
  const tools = windowsHostTools()
  return new Promise((resolve, reject) => {
    const child = spawn(tools.taskkill, ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore', env: tools.environment })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Windows process-tree termination timed out')) }, 10000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => {
      clearTimeout(timer)
      if (code === 0) { resolve(); return }
      // taskkill returns 128 when the worker exits before its process snapshot.
      if (code === 128) {
        try { process.kill(pid, 0) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') { resolve(); return } }
      }
      reject(new Error(`Windows process-tree termination was not confirmed (taskkill ${code})`))
    })
  })
}

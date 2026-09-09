import { readFileSync, readlinkSync, realpathSync } from 'node:fs'
import path from 'node:path'

export interface OpenTtdProcessIdentity {
  pid: number; process_start_ticks: string; process_executable: string; launch_target: string; config_path: string
}
/** Match the launcher's process identity, so PID reuse cannot select a different game. */
export function assertOpenTtdProcess(identity: OpenTtdProcessIdentity) {
  if (process.platform !== 'linux') throw new Error('Managed OpenTTD process identity requires Linux')
  const root = `/proc/${identity.pid}`
  const expected = realpathSync(identity.process_executable), target = realpathSync(identity.launch_target)
  realpathSync(identity.config_path)
  const start = () => {
    const stat = readFileSync(`${root}/stat`, 'utf8'), end = stat.lastIndexOf(')')
    if (end < 0) throw new Error('Malformed managed process identity')
    const fields = stat.slice(end + 1).trim().split(/\s+/)
    if (['Z', 'X', 'x'].includes(fields[0] ?? '') || fields[19] !== identity.process_start_ticks) throw new Error('Managed OpenTTD process changed or exited')
  }
  start()
  const executable = realpathSync(readlinkSync(`${root}/exe`))
  if (executable !== expected) throw new Error('Managed OpenTTD executable changed')
  if (executable !== target) {
    const argv = readFileSync(`${root}/cmdline`)
    if (argv.length > 1024 * 1024) throw new Error('Managed process command line exceeds limit')
    const matched = argv.toString('utf8').split('\0').some(argument => {
      if (!path.isAbsolute(argument)) return false
      try { return realpathSync(argument) === target } catch { return false }
    })
    if (!matched) throw new Error('Managed process no longer contains the OpenTTD launch target')
  }
  start()
}

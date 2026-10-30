import * as fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

function quote(value) {
  if (/[\x00-\x1f]/.test(value)) throw new Error('Invalid service path')
  return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', '$$') + '"'
}
export async function stopMonpmDaemon(monpm, config, command) {
  try { await command(monpm, ['daemon', 'shutdown', '-config', config]) }
  catch (error) {
    // Fresh installs have no IPC socket; a stale socket can also refer to an already stopped daemon.
    if (!/^dial unix [^\r\n]+: connect: (no such file or directory|connection refused)\s*$/.test(String(error?.stderr ?? ''))) throw error
  }
}
async function rootService(monpm, config, command) {
  const id = createHash('sha256').update(config).digest('hex').slice(0, 16)
  const name = `eden-shared-host-${id}.service`, filename = path.join('/etc/systemd/system', name)
  const header = `# EDEN SharedWorkspace ${id}\n`
  try {
    const info = await fs.lstat(filename)
    if (!info.isFile() || info.isSymbolicLink() || !(await fs.readFile(filename, 'utf8')).startsWith(header)) throw new Error('Service path occupied')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const contents = `${header}[Unit]\nDescription=EDEN shared workspace host\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=${quote(monpm)} daemon -config ${quote(config)}\nWorkingDirectory=${quote(path.dirname(config))}\nKillMode=process\nRestart=on-failure\nRestartSec=2\n\n[Install]\nWantedBy=multi-user.target\n`
  await fs.writeFile(filename, contents, { mode: 0o644 })
  await command('systemctl', ['daemon-reload'])
  await stopMonpmDaemon(monpm, config, command)
  await command('systemctl', ['enable', name])
  await command('systemctl', ['restart', name])
}

export async function installBootService(monpm, config, command) {
  const systemd = await fs.stat('/run/systemd/system').then(value => value.isDirectory(), () => false)
  if (process.getuid() === 0 && systemd) { await rootService(monpm, config, command); return }
  await command(monpm, ['service', 'install', '-config', config])
  await stopMonpmDaemon(monpm, config, command)
  await command(monpm, ['service', 'start', '-config', config])
}

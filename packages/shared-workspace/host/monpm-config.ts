import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { HostConfiguration } from './config.ts'

/** Foreground by default; persistent background supervision is owned by MonPM. */
export function writeHostMonpmConfig(config: HostConfiguration, entry: string): void {
  const args = [path.resolve(entry), '--data', config.dataRoot, '--name', config.name, '--host', config.host, '--port', String(config.port)]
  for (const address of config.addresses) args.push('--public-address', address)
  if (config.cert && config.key) args.push('--tls-cert', config.cert, '--tls-key', config.key)
  const value = { version: 2, log_dir: path.join(config.dataRoot, 'logs'), apps: [{
    name: 'shared-workspace-host', command: process.execPath, args, cwd: path.dirname(path.resolve(entry)),
    auto_start: true, auto_restart: true, ports: [config.port],
    healthcheck: { type: 'tcp', address: `127.0.0.1:${config.port}`, interval_ms: 5000, timeout_ms: 1500, retries: 5, start_period_ms: 10000, restart_on_failure: true },
  }] }
  writeFileSync(config.monpmConfig!, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
}

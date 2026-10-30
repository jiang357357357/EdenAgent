import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createSharedLanRuntime } from '../lan/runtime.ts'
import { readHostConfiguration } from './config.ts'
import { writeHostMonpmConfig } from './monpm-config.ts'

async function main(): Promise<void> {
  const [major, minor, patch] = process.versions.node.split('.').map(Number)
  if (major! < 22 || (major === 22 && (minor! < 23 || (minor === 23 && patch! < 1)))) throw new Error('共享主机需要 Node.js 22.23.1 或更新版本')
  const config = readHostConfiguration(process.argv.slice(2))
  if (config.monpmConfig) {
    writeHostMonpmConfig(config, process.argv[1]!)
    process.stdout.write(`已生成 MonPM 配置：${config.monpmConfig}\n`)
    return
  }
  let running = true
  const runtime = await createSharedLanRuntime({ dataRoot: config.dataRoot, name: config.name, active: () => running,
    canPublish: () => true, dedicated: true, discovery: false, host: config.host, port: config.port,
    publicAddresses: config.addresses, administrators: config.setup.administrators,
    ...(config.cert && config.key ? { tls: { cert: readFileSync(config.cert), key: readFileSync(config.key) } } : {}),
  })
  let invitationExpires = 0
  const invite = () => {
    const invitation = runtime.invite()
    invitationExpires = invitation.expiresAt
    process.stdout.write(JSON.stringify({ event: 'shared_host_pairing_invitation', code: invitation.code,
      expiresAt: invitation.expiresAt, addresses: runtime.network().addresses }) + '\n')
  }
  process.stdout.write(JSON.stringify({ event: 'shared_host_ready', ...runtime.network(), dataRoot: config.dataRoot }) + '\n')
  invite()
  const refresh = setInterval(() => {
    const paired = runtime.network().peers.some(peer => peer.paired && config.setup.administrators.some(admin => admin.deviceId === peer.deviceId))
    if (!paired && Date.now() >= invitationExpires) invite()
  }, 30_000)
  const input = process.stdin.isTTY ? createInterface({ input: process.stdin }) : undefined
  input?.on('line', line => { if (line.trim() === 'invite') invite() })
  await new Promise<void>(resolve => {
    const stop = () => { if (!running) return; running = false; clearInterval(refresh); input?.close(); resolve() }
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
  })
  await runtime.close()
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })

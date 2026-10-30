import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { HostAdministrator } from '../lan/contracts.ts'
import { hostEndpoint, publicKey, record, text, uuid } from '../lan/validation.ts'

export interface HostSetup { schemaVersion: 1; capability: 'workspace.publish.v2'; administrators: HostAdministrator[] }
export interface HostConfiguration {
  setup: HostSetup; dataRoot: string; name: string; host: string; port: number; addresses: string[]
  cert?: string; key?: string; monpmConfig?: string
}

function setup(value: unknown): HostSetup {
  const input = record(value)
  if (input.schemaVersion !== 1 || input.capability !== 'workspace.publish.v2' || !Array.isArray(input.administrators)
    || !input.administrators.length || input.administrators.length > 32) throw new Error('无效共享主机部署配置，请从启用 DLC 的子机重新部署')
  const administrators = input.administrators.map(value => {
    const admin = record(value)
    return { deviceId: uuid(admin.deviceId), publicKey: publicKey(admin.publicKey) }
  })
  if (new Set(administrators.map(value => value.deviceId)).size !== administrators.length) throw new Error('共享主机管理员身份重复')
  return { schemaVersion: 1, capability: 'workspace.publish.v2', administrators }
}

export function readHostConfiguration(args: string[]): HostConfiguration {
  const parsed = parseArgs({ args, allowPositionals: false, options: {
    data: { type: 'string' }, name: { type: 'string' }, host: { type: 'string' }, port: { type: 'string' },
    'public-address': { type: 'string', multiple: true }, 'tls-cert': { type: 'string' }, 'tls-key': { type: 'string' },
    'write-monpm-config': { type: 'string' },
  } }).values
  const dataRoot = path.resolve(parsed.data ?? './shared-host-data')
  const port = Number(parsed.port ?? '40195')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('共享主机端口必须在 1 到 65535 之间')
  if (Boolean(parsed['tls-cert']) !== Boolean(parsed['tls-key'])) throw new Error('TLS 证书和私钥必须同时配置')
  const addresses = (parsed['public-address'] ?? []).map(hostEndpoint)
  const loaded = loadSetup(dataRoot)
  return { setup: loaded, dataRoot, name: text(parsed.name ?? 'EDEN 共享主机'), host: parsed.host ?? '0.0.0.0', port, addresses,
    ...(parsed['tls-cert'] ? { cert: path.resolve(parsed['tls-cert']), key: path.resolve(parsed['tls-key']!) } : {}),
    ...(parsed['write-monpm-config'] ? { monpmConfig: path.resolve(parsed['write-monpm-config']) } : {}),
  }
}

function loadSetup(dataRoot: string): HostSetup {
  const filename = path.join(dataRoot, 'host-setup.json')
  const embedded = process.env.EDEN_SHARED_HOST_BOOTSTRAP
  const seed = embedded ? setup(JSON.parse(Buffer.from(embedded, 'base64url').toString('utf8'))) : undefined
  delete process.env.EDEN_SHARED_HOST_BOOTSTRAP
  let loaded: HostSetup
  if (existsSync(filename)) {
    loaded = setup(JSON.parse(readFileSync(filename, 'utf8')))
    if (seed && !seed.administrators.some(admin => loaded.administrators.some(existing => existing.deviceId === admin.deviceId && existing.publicKey === admin.publicKey)))
      throw new Error('此数据目录属于另一部署身份；请使用原运行文件或由服务器管理员明确更新 host-setup.json')
  } else {
    if (!seed) throw new Error('请先从已启用共享资料库 DLC 的子机部署共享主机')
    loaded = seed
    mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
    writeFileSync(filename, JSON.stringify(loaded, null, 2), { mode: 0o600, flag: 'wx' })
  }
  return loaded
}

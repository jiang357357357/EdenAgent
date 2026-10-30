import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'
import { launchNode, realmEnvironment, resolveDevelopmentRealmRoot, stopChild, waitForHealth, waitForWeb } from './runtime_children.mjs'
import { assertDevelopmentPortAvailable, resolveDevelopmentRealm } from './development-realm.mjs'
import workspaceIdentity from '../../frontend/desktop/src/processes/workspace-identity.cjs'
import { buildServer } from './build_server.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const identity = workspaceIdentity.workspaceIdentity(root)
const serverEnv = { ...process.env, ...(identity.monWorkspaceRoot ? { MON_WORKSPACE_ROOT: identity.monWorkspaceRoot } : {}) }
const require = createRequire(import.meta.url)
const dataRoots = {
  mon: resolveDevelopmentRealmRoot(root, 'mon', process.env.EDEN_AGENT_MON_DATA_ROOT),
  local: resolveDevelopmentRealmRoot(root, 'local', process.env.EDEN_AGENT_LOCAL_DATA_ROOT),
}
const children = []
const tokens = {}
const ports = { mon: Number(process.env.EDEN_AGENT_MON_PORT ?? 40092), local: Number(process.env.EDEN_AGENT_LOCAL_PORT ?? 40093) }
const webPort = Number(process.env.EDEN_AGENT_WEB_PORT ?? 40091)
let stopping = false
async function shutdown(code) {
  if (stopping) return
  stopping = true
  await Promise.all(children.map(stopChild))
  process.exitCode = code
}
function start(label, args, env) {
  const child = launchNode(root, args, env)
  children.push(child)
  child.once('error', error => { process.stderr.write(`[dev] ${label} 启动失败：${error.message}\n`); void shutdown(1) })
  child.once('exit', (code, signal) => {
    if (stopping) return
    process.stderr.write(`[dev] ${label} 已退出（code=${code}, signal=${signal ?? 'none'}），正在关闭本次启动的服务\n`)
    void shutdown(code ?? 1)
  })
  return child
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown(0) })
process.on('message', message => { if (message === 'shutdown') void shutdown(0).then(() => process.disconnect?.()) })
try {
  if (new Set([ports.mon, ports.local, webPort]).size !== 3) throw new Error('两个世界和 Web 必须使用不同端口')
  await assertDevelopmentPortAvailable(webPort, 'Web')
  const realms = await Promise.all(['mon', 'local'].map(origin => resolveDevelopmentRealm({
    origin, port: ports[origin], dataRoot: dataRoots[origin], workspaceId: identity.workspaceId,
    ...(process.env[`EDEN_AGENT_${origin.toUpperCase()}_TOKEN_FILE`]?.trim()
      ? { tokenFile: path.resolve(root, process.env[`EDEN_AGENT_${origin.toUpperCase()}_TOKEN_FILE`].trim()) } : {}),
  })))
  for (const realm of realms) tokens[realm.origin] = realm.token
  await buildServer(root)
  const checks = []
  for (const realm of realms) {
    const { origin, port } = realm
    if (!realm.owned) {
      process.stdout.write(`[dev] 复用本工作区 ${origin} Agent（端口 ${port}），由原启动器持有；退出开发端不会停止它\n`)
      continue
    }
    const child = start(`${origin} Agent`, ['dist/server/main.mjs'], {
      ...realmEnvironment(serverEnv, origin, tokens[origin], port), EDEN_AGENT_DATA_ROOT: dataRoots[origin],
    })
    checks.push(waitForHealth(port, origin, child, { workspaceId: identity.workspaceId }))
  }
  await Promise.all(checks)
  const clientEnv = {
    ...serverEnv, EDEN_AGENT_EXTERNAL_ORIGINS: 'mon,local', EDEN_AGENT_SERVER_MODE: '',
    VITE_EDEN_AGENT_WORKSPACE_ID: identity.workspaceId,
    EDEN_AGENT_MON_PORT: String(ports.mon), EDEN_AGENT_LOCAL_PORT: String(ports.local),
    EDEN_AGENT_MON_CAPABILITY_TOKEN: tokens.mon, EDEN_AGENT_LOCAL_CAPABILITY_TOKEN: tokens.local,
    EDEN_AGENT_MON_DATA_ROOT: dataRoots.mon, EDEN_AGENT_LOCAL_DATA_ROOT: dataRoots.local,
    EDEN_AGENT_MON_TOKEN_FILE: realms.find(realm => realm.origin === 'mon').tokenFile,
    EDEN_AGENT_LOCAL_TOKEN_FILE: realms.find(realm => realm.origin === 'local').tokenFile,
    VITE_EDEN_AGENT_MON_BASE_URL: `http://127.0.0.1:${ports.mon}`,
    VITE_EDEN_AGENT_LOCAL_BASE_URL: `http://127.0.0.1:${ports.local}`,
    VITE_EDEN_AGENT_MON_CAPABILITY_TOKEN: tokens.mon, VITE_EDEN_AGENT_LOCAL_CAPABILITY_TOKEN: tokens.local,
  }
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js')
  const web = start('Web', [vite, 'frontend/web', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], clientEnv)
  await waitForWeb(webPort, web)
  if (!process.argv.includes('--web-only')) {
    const desktopEnv = { ...clientEnv, EDEN_AGENT_WEB_URL: `http://127.0.0.1:${webPort}` }
    delete desktopEnv.ELECTRON_RUN_AS_NODE
    start('Desktop', ['frontend/desktop/Script/launch-electron.cjs', 'frontend/desktop'], desktopEnv)
  }
  process.stdout.write('TS runtime development started. Business migration remains in progress.\n')
} catch (error) {
  process.stderr.write(`Development startup failed: ${error.message}\n`)
  await shutdown(1)
}

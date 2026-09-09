import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'
import { launchNode, realmEnvironment, stopChild, waitForHealth, waitForWeb } from './runtime_children.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const children = []
const tokens = { mon: randomBytes(32).toString('base64url'), local: randomBytes(32).toString('base64url') }
const ports = { mon: Number(process.env.EDEN_AGENT_MON_PORT ?? 40092), local: Number(process.env.EDEN_AGENT_LOCAL_PORT ?? 40093) }
const webPort = Number(process.env.EDEN_AGENT_WEB_PORT ?? 40091)
let stopping = false
async function shutdown(code) {
  if (stopping) return
  stopping = true
  await Promise.all(children.map(stopChild))
  process.exitCode = code
}
function start(args, env) {
  const child = launchNode(root, args, env)
  children.push(child)
  child.once('error', error => { process.stderr.write(`${error.message}\n`); void shutdown(1) })
  child.once('exit', code => { if (!stopping) void shutdown(code ?? 1) })
  return child
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown(0) })
try {
  const checks = []
  for (const origin of ['mon', 'local']) {
    const child = start(['--import', 'tsx', 'Server/src/main.ts'], realmEnvironment(process.env, origin, tokens[origin], ports[origin]))
    checks.push(waitForHealth(ports[origin], origin, child))
  }
  await Promise.all(checks)
  const clientEnv = {
    ...process.env, EDEN_AGENT_EXTERNAL_ORIGINS: 'mon,local', EDEN_AGENT_SERVER_MODE: '',
    EDEN_AGENT_MON_PORT: String(ports.mon), EDEN_AGENT_LOCAL_PORT: String(ports.local),
    EDEN_AGENT_MON_CAPABILITY_TOKEN: tokens.mon, EDEN_AGENT_LOCAL_CAPABILITY_TOKEN: tokens.local,
    EDEN_AGENT_MON_TOKEN_FILE: path.join(root, 'Data/realms/mon/v2/capability.token'),
    EDEN_AGENT_LOCAL_TOKEN_FILE: path.join(root, 'Data/realms/local/v2/capability.token'),
    VITE_EDEN_AGENT_MON_BASE_URL: `http://127.0.0.1:${ports.mon}`,
    VITE_EDEN_AGENT_LOCAL_BASE_URL: `http://127.0.0.1:${ports.local}`,
    VITE_EDEN_AGENT_MON_CAPABILITY_TOKEN: tokens.mon, VITE_EDEN_AGENT_LOCAL_CAPABILITY_TOKEN: tokens.local,
  }
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js')
  const web = start([vite, 'frontend/web', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], clientEnv)
  await waitForWeb(webPort, web)
  if (!process.argv.includes('--web-only')) {
    const electron = require.resolve('electron/cli.js')
    start([electron, 'frontend/desktop'], { ...clientEnv, EDEN_AGENT_WEB_URL: `http://127.0.0.1:${webPort}` })
  }
  process.stdout.write('TS runtime development started. Business migration remains in progress.\n')
} catch (error) {
  process.stderr.write(`Development startup failed: ${error.message}\n`)
  await shutdown(1)
}

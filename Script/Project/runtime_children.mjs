import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import commandEnvironment from '../../frontend/desktop/src/processes/realm-command-environment.cjs'
import portTakeover from '../../frontend/desktop/src/processes/port-takeover.cjs'

export const { takeOverTcpPort } = portTakeover

function isCurrentRealmDatabase(filename) {
  if (!existsSync(filename)) return false
  const database = new DatabaseSync(filename, { readOnly: true })
  try {
    return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='realm_meta'").get())
  } finally {
    database.close()
  }
}

export function resolveDevelopmentRealmRoot(root, origin, configured) {
  if (configured?.trim()) return path.resolve(configured)
  const current = path.join(root, 'Data', 'realms', origin)
  const currentDatabase = path.join(current, 'eden-agent.db')
  const retainedV2 = path.join(current, 'v2')
  if (existsSync(currentDatabase) && !isCurrentRealmDatabase(currentDatabase) && isCurrentRealmDatabase(path.join(retainedV2, 'eden-agent.db'))) {
    return retainedV2
  }
  return current
}

export function launchNode(root, args, env) {
  return spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', detached: process.platform !== 'win32' })
}

export async function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)])
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      killer.once('error', resolve)
      killer.once('exit', resolve)
    })
  } else {
    try { process.kill(-child.pid, 'SIGKILL') }
    catch (error) { if (error.code !== 'ESRCH') throw error }
  }
}

export async function waitForHealth(port, origin, child, { timeoutMs = 60000, intervalMs = 100 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(intervalMs) || intervalMs < 0) throw new Error('Invalid startup wait bounds')
  const started = performance.now()
  const endpoint = `http://127.0.0.1:${port}/healthz`
  let detail = 'No response received'
  let requestError = ''
  while (performance.now() - started < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${origin} Server exited before health check (code=${child.exitCode}, signal=${child.signalCode})`)
    try {
      const remaining = Math.max(1, Math.ceil(timeoutMs - (performance.now() - started)))
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(Math.min(500, remaining)) })
      requestError = ''
      detail = `HTTP ${response.status}`
      const health = await response.json()
      if (response.ok && health.runtimeOrigin === origin && health.serverVersion === '2.0.0-dev.0') return
      detail += `; origin=${health.runtimeOrigin}, version=${health.serverVersion}`
    } catch (error) {
      requestError = `; request failed: ${error.cause?.code ?? error.message}`.slice(0, 500)
    }
    const remaining = timeoutMs - (performance.now() - started)
    if (remaining > 0) await delay(Math.min(intervalMs, remaining))
  }
  throw new Error(`${origin} Server startup timed out after ${Math.round(performance.now() - started)}ms (${endpoint}; ${detail}${requestError}). Check server.startup logs for the last initialization stage.`)
}

export async function waitForWeb(port, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Web process exited before startup')
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })
      if (response.ok) return
    } catch { /* Vite may not yet accept connections. */ }
    await delay(100)
  }
  throw new Error('Web startup timed out')
}

export function realmEnvironment(base, origin, token, port) {
  const allowed = ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'EDEN_AGENT_ALLOWED_ORIGINS', 'EDEN_AGENT_MAX_BLOB_BYTES', 'EDEN_AGENT_TERMINAL_SETTINGS_PATH']
  const env = Object.fromEntries(allowed.filter(key => base[key] !== undefined).map(key => [key, base[key]]))
  const skillRootsKey = `EDEN_AGENT_${origin.toUpperCase()}_SYSTEM_SKILL_ROOTS`
  if (base[skillRootsKey] !== undefined) env[skillRootsKey] = base[skillRootsKey]
  if (origin === 'mon') for (const key of ['MON_SERVICE_SHARED_SECRET', 'MON_SERVICE_USER_ID', 'MON_CORE_BASE_URL']) { if (base[key] !== undefined) env[key] = base[key] }
  if (origin === 'local') {
    const provider = base.EDEN_AGENT_MODEL?.split('/')[0]
    const credential = provider ? `${provider.toUpperCase().replaceAll('-', '_')}_API_KEY` : undefined
    for (const [key, value] of Object.entries(base)) {
      if (key === credential || key === 'OPENAI_API_KEY' || ['EDEN_AGENT_MODEL', 'EDEN_AGENT_BASE_URL', 'OPENAI_BASE_URL', 'EDEN_AGENT_CONTEXT_WINDOW', 'EDEN_AGENT_MAX_TOKENS', 'EDEN_AGENT_MODEL_COST'].includes(key)) env[key] = value
    }
  }
  return { ...env, ...commandEnvironment.realmCommandEnvironment(base, origin), EDEN_AGENT_RUNTIME_ORIGIN: origin, EDEN_AGENT_PORT: String(port), EDEN_AGENT_CAPABILITY_TOKEN: token }
}

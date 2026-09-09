import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import commandEnvironment from '../../frontend/desktop/src/processes/realm-command-environment.cjs'

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

export async function waitForHealth(port, origin, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${origin} Server exited before health check`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) })
      const health = await response.json()
      if (response.ok && health.runtimeOrigin === origin && health.serverVersion === '2.0.0-dev.0') return
    } catch { /* A starting server may not yet accept a connection. */ }
    await delay(100)
  }
  throw new Error(`${origin} Server startup timed out`)
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
  const allowed = ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'EDEN_AGENT_ALLOWED_ORIGINS', 'EDEN_AGENT_MAX_BLOB_BYTES']
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

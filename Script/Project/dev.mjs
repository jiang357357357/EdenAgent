import net from "node:net"
import { randomBytes } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { spawnExecutable, spawnNpm } from "../../frontend/Script/Project/process_runner.mjs"
import { loadMonConfig } from "./monconfig.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const require = createRequire(import.meta.url)
const { createLocalRuntimeConfigStore } = require("../../frontend/desktop/src/app/local-runtime-config.cjs")
const config = loadMonConfig(root)
const localRuntimeConfig = createLocalRuntimeConfigStore({
  app: { isPackaged: false, getPath: () => path.join(root, "Data") },
  agentRoot: root,
})
const localRuntimeEnvironment = localRuntimeConfig.environment()
const monRuntimeEnvironmentExclusions = Object.fromEntries(
  [...new Set([...Object.keys(localRuntimeEnvironment), "OPENAI_API_KEY", "OPENAI_BASE_URL"])]
    .map((key) => [key, undefined]),
)
const serverPort = Number(process.env.EDEN_AGENT_PORT ?? config.number("server", "PORT", 40092))
const localServerPort = Number(process.env.EDEN_AGENT_LOCAL_PORT ?? config.number("server", "LOCAL_PORT", serverPort + 1))
const webPort = Number(process.env.EDEN_AGENT_WEB_PORT ?? config.number("server", "WEB_PORT", 40091))
const serverReadyTimeoutMs = positiveTimeout(
  process.env.EDEN_AGENT_SERVER_READY_TIMEOUT_MS ?? config.number("server", "READY_TIMEOUT_MS", 300_000),
  "server readiness timeout",
)
const webReadyTimeoutMs = positiveTimeout(
  process.env.EDEN_AGENT_WEB_READY_TIMEOUT_MS ?? config.number("server", "WEB_READY_TIMEOUT_MS", 60_000),
  "web readiness timeout",
)
const quitFlag = config.path("desktop", "QUIT_FLAG", ".artifacts/desktop-quit.flag")
const capabilityTokens = {
  mon: process.env.EDEN_AGENT_MON_CAPABILITY_TOKEN ?? process.env.EDEN_AGENT_CAPABILITY_TOKEN ?? randomBytes(32).toString("hex"),
  local: process.env.EDEN_AGENT_LOCAL_CAPABILITY_TOKEN ?? randomBytes(32).toString("hex"),
}
const realmDataRoot = path.join(root, "Data", "realms")

function realmPaths(origin) {
  const dataRoot = path.join(realmDataRoot, origin)
  return {
    dataRoot,
    database: path.join(dataRoot, "eden-agent.db"),
    blobs: path.join(dataRoot, "blobs"),
    logs: path.join(dataRoot, "logs"),
    plugins: path.join(dataRoot, "plugins"),
    skills: path.join(dataRoot, "skills"),
    connectors: path.join(dataRoot, "connectors"),
    agents: path.join(dataRoot, "agents"),
    tokenFile: path.join(dataRoot, "capability.token"),
    migrationMarker: path.join(dataRoot, ".realm-migration-pending"),
    migrationComplete: path.join(dataRoot, ".realm-migration-complete"),
  }
}

function copyIfMissing(source, target) {
  if (!existsSync(source) || existsSync(target)) return false
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  cpSync(source, target, { recursive: true, preserveTimestamps: true })
  return true
}

function prepareRealmData(origin) {
  const paths = realmPaths(origin)
  mkdirSync(paths.dataRoot, { recursive: true, mode: 0o700 })
  for (const suffix of ["", "-wal", "-shm"]) {
    copyIfMissing(path.join(root, "Data", `eden-agent.db${suffix}`), `${paths.database}${suffix}`)
  }
  copyIfMissing(path.join(root, "Data", "blobs"), paths.blobs)
  copyIfMissing(path.join(root, "Data", "plugins"), paths.plugins)
  copyIfMissing(path.join(root, "Data", "skills"), paths.skills)
  copyIfMissing(path.join(root, "Data", "connectors"), paths.connectors)
  copyIfMissing(path.join(root, "Data", "agents"), paths.agents)
  if (origin === "local") {
    copyIfMissing(path.join(root, "Data", "local-runtime.json"), path.join(paths.dataRoot, "local-runtime.json"))
  }
  if (existsSync(path.join(root, "Data", "eden-agent.db")) && !existsSync(paths.migrationComplete)) {
    writeFileSync(paths.migrationMarker, `${origin}\n`, { mode: 0o600 })
  }
  return paths
}

rmSync(quitFlag, { force: true })

const children = []
let shuttingDown = false
let quitWatcherArmed = false

function handleOutputError(error) {
  if (error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED") {
    void shutdown(0)
    return
  }
  setImmediate(() => { throw error })
}

process.stdout.on("error", handleOutputError)
process.stderr.on("error", handleOutputError)

const ansi = {
  reset: "\x1b[0m",
  dev: "\x1b[90m",
  server: "\x1b[36m",
  web: "\x1b[35m",
  desktop: "\x1b[32m",
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function positiveTimeout(value, label) {
  const timeout = Number(value)
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`${label} must be a positive number of milliseconds, got ${JSON.stringify(value)}`)
  }
  return timeout
}

async function probeEdenAgentServer(port, expectedOrigin) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: controller.signal })
    if (!response.ok) return false
    const health = await response.json()
    return health?.status === "ok" && health?.runtimeOrigin === expectedOrigin &&
      typeof health?.serverVersion === "string" &&
      Number.isInteger(health?.protocolVersion)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function externalCapabilityToken(origin) {
  const configured = origin === "local"
    ? process.env.EDEN_AGENT_LOCAL_CAPABILITY_TOKEN
    : process.env.EDEN_AGENT_MON_CAPABILITY_TOKEN ?? process.env.EDEN_AGENT_CAPABILITY_TOKEN
  if (configured?.trim()) {
    return configured.trim()
  }
  const tokenFile = realmPaths(origin).tokenFile
  try {
    const token = readFileSync(tokenFile, "utf8").trim()
    if (token.length >= 32) return token
  } catch {}
  throw new Error(`检测到已运行的 ${origin} Eden Agent Server，但无法读取其能力令牌：${tokenFile}`)
}

function labelText(label) {
  const color = label.startsWith("server") ? ansi.server : label === "web" ? ansi.web : label === "desktop" ? ansi.desktop : ansi.dev
  return `${color}[${label}]${ansi.reset}`
}

function devLog(message) {
  console.log(`${labelText("dev")} ${message}`)
}

function writeLine(label, line, stream) {
  if (!line) return
  const target = stream === "stderr" ? process.stderr : process.stdout
  target.write(`${labelText(label)} ${line}\n`)
}

function prefixOutput(label, readable, stream) {
  if (!readable) return
  let pending = ""
  readable.setEncoding("utf8")
  readable.on("data", (chunk) => {
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ""
    for (const line of lines) writeLine(label, line, stream)
  })
  readable.on("end", () => {
    if (pending) writeLine(label, pending, stream)
  })
}

function runWithTimeout(cmd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawnExecutable(cmd[0], cmd.slice(1), { cwd: root, stdio: "ignore" })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on("exit", () => {
      clearTimeout(timer)
      resolve()
    })
    child.on("error", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function runCapture(cmd, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const child = spawnExecutable(cmd[0], cmd.slice(1), {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("exit", (exitCode) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode })
    })
    child.on("error", () => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: 1 })
    })
  })
}

async function killProcessTree(proc) {
  if (!proc?.pid) return
  if (process.platform === "win32") {
    await runWithTimeout(["taskkill", "/PID", String(proc.pid), "/T", "/F"], 3000).catch(() => {})
    return
  }
  try {
    process.kill(-proc.pid, "SIGTERM")
  } catch {
    proc.kill("SIGTERM")
  }
}

async function killPidTree(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return
  if (process.platform === "win32") {
    await runWithTimeout(["taskkill", "/PID", String(pid), "/T", "/F"], 3000).catch(() => {})
    return
  }
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try {
      process.kill(pid, "SIGTERM")
    } catch {}
  }
}

async function portPids(port) {
  const pids = new Set()
  const addPid = (value) => {
    const text = String(value ?? "").trim()
    if (!/^[1-9]\d*$/.test(text)) return
    pids.add(Number(text))
  }

  if (process.platform === "win32") {
    const result = await runCapture(["netstat", "-ano"], 5000).catch(() => ({ stdout: "", stderr: "", exitCode: 1 }))
    const pattern = new RegExp(`(?:0\\.0\\.0\\.0|127\\.0\\.0\\.1|\\[?::\\]?):${port}\\s+.*\\s+LISTENING\\s+(\\d+)`, "i")
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = line.match(pattern)
      addPid(match?.[1])
    }
    return [...pids]
  }

  const lsof = await runCapture(["lsof", `-tiTCP:${port}`, "-sTCP:LISTEN", "-P", "-n"], 5000).catch(() => ({
    stdout: "",
    stderr: "",
    exitCode: 1,
  }))
  for (const line of lsof.stdout.split(/\r?\n/)) {
    addPid(line)
  }
  if (pids.size) return [...pids]

  const ss = await runCapture(["ss", "-ltnp", `( sport = :${port} )`], 5000).catch(() => ({
    stdout: "",
    stderr: "",
    exitCode: 1,
  }))
  for (const match of ss.stdout.matchAll(/pid=(\d+)/g)) {
    addPid(match[1])
  }
  if (pids.size) return [...pids]

  const fuser = await runCapture(["fuser", `${port}/tcp`], 5000).catch(() => ({
    stdout: "",
    stderr: "",
    exitCode: 1,
  }))
  for (const token of `${fuser.stdout}\n${fuser.stderr}`.split(/\s+/)) {
    addPid(token)
  }
  return [...pids]
}

async function processCommandLine(pid) {
  if (process.platform !== "win32") {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim()
    } catch {
      const result = await runCapture(["ps", "-p", String(pid), "-o", "command="], 3000).catch(() => ({
        stdout: "",
        stderr: "",
        exitCode: 1,
      }))
      return result.stdout.trim()
    }
  }

  const script = `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -ExpandProperty CommandLine`
  const result = await runCapture(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], 5000).catch(() => ({
    stdout: "",
    stderr: "",
    exitCode: 1,
  }))
  return result.stdout.trim()
}

async function releaseOwnedPort(port, label) {
  const pids = await portPids(port)
  if (!pids.length) return

  for (const pid of pids) {
    const commandLine = await processCommandLine(pid)
    devLog(`清理占用 ${label} 端口 ${port} 的进程，PID ${pid}${commandLine ? `：${commandLine}` : ""}`)
    await killPidTree(pid)
  }

  for (let index = 0; index < 20; index += 1) {
    if (!(await portPids(port)).length) return
    await sleep(250)
  }
}

function childEnv(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === null) delete env[key]
  }
  return env
}

function start(label, args, extraEnv = {}) {
  const child = spawnNpm(args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv(extraEnv),
    detached: process.platform !== "win32",
  })
  children.push(child)

  prefixOutput(label, child.stdout, "stdout")
  prefixOutput(label, child.stderr, "stderr")
  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      process.stderr.write(`${labelText("dev")} ${label} exited with code ${code}\n`)
      shutdown(code || 1)
    }
  })
  child.on("error", (error) => {
    if (!shuttingDown) {
      process.stderr.write(`${labelText("dev")} 无法启动 ${label}: ${error.message}\n`)
      void shutdown(1)
    }
  })

  return child
}

async function waitFor(url, label, child, timeoutMs) {
  let exited = false
  let exitCode = null
  if (child) {
    child.on("exit", (code) => {
      exited = true
      exitCode = code
    })
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`${label} 启动进程已退出，退出码：${exitCode}`)
    }
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 304) return
    } catch {}
    await sleep(Math.min(500, Math.max(1, deadline - Date.now())))
  }
  throw new Error(`${label} 未在 ${Math.ceil(timeoutMs / 1000)}s 内就绪：${url}`)
}

function assertPortFree(port, label) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once("error", () => reject(new Error(`${label} 端口 ${port} 已被占用，请先退出旧的 Eden Agent 进程或释放该端口。`)))
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve())
    })
  })
}

async function ensurePortFree(port, label) {
  if (process.platform === "linux" && port === serverPort) {
    const stopManagedServer = path.join(root, "Script", "Process", "linux", "server", "stop_process.sh")
    if (existsSync(stopManagedServer)) {
      await runWithTimeout(["bash", stopManagedServer], 10_000).catch(() => {})
    }
  }
  await releaseOwnedPort(port, label)
  await assertPortFree(port, label)
}

async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of [...children].reverse()) await killProcessTree(child)
  process.exit(code)
}

process.on("SIGINT", () => void shutdown(0))
process.on("SIGTERM", () => void shutdown(0))
if (process.platform !== "win32") process.on("SIGHUP", () => void shutdown(0))

const quitWatcher = setInterval(() => {
  if (quitWatcherArmed && existsSync(quitFlag)) {
    devLog("检测到桌面退出标记，正在退出 server / web / desktop")
    void shutdown(0)
  }
}, 500)
quitWatcher.unref?.()

try {
  let reuseMonServer = await probeEdenAgentServer(serverPort, "mon")
  let reuseLocalServer = await probeEdenAgentServer(localServerPort, "local")
  if (reuseMonServer) {
    try {
      capabilityTokens.mon = externalCapabilityToken("mon")
      devLog(`复用已运行的伊甸园 Server，端口 ${serverPort}`)
    } catch (error) {
      reuseMonServer = false
      devLog(`${error instanceof Error ? error.message : String(error)}；改为安全接管`)
    }
  }
  if (!reuseMonServer) await ensurePortFree(serverPort, "伊甸园 server")
  if (reuseLocalServer) {
    try {
      capabilityTokens.local = externalCapabilityToken("local")
      devLog(`复用已运行的尘世 Server，端口 ${localServerPort}`)
    } catch (error) {
      reuseLocalServer = false
      devLog(`${error instanceof Error ? error.message : String(error)}；改为安全接管`)
    }
  }
  if (!reuseLocalServer) await ensurePortFree(localServerPort, "尘世 server")
  await ensurePortFree(webPort, "web")

  const monPaths = prepareRealmData("mon")
  const localPaths = prepareRealmData("local")
  let monServer = null
  let localServer = null
  if (!reuseMonServer) {
    devLog(`启动伊甸园 server，端口 ${serverPort}`)
    monServer = start("server-mon", ["run", "dev:server"], {
      EDEN_AGENT_RUNTIME_ORIGIN: "mon",
      EDEN_AGENT_BIND: `127.0.0.1:${serverPort}`,
      EDEN_AGENT_CAPABILITY_TOKEN: capabilityTokens.mon,
      EDEN_AGENT_TOKEN_FILE: monPaths.tokenFile,
      EDEN_AGENT_DATABASE: monPaths.database,
      EDEN_AGENT_BLOB_ROOT: monPaths.blobs,
      EDEN_AGENT_LOG_DIRECTORY: monPaths.logs,
      EDEN_AGENT_PLUGIN_ROOT: monPaths.plugins,
      EDEN_AGENT_SKILL_INSTALL_ROOT: monPaths.skills,
      EDEN_AGENT_CONNECTOR_PACKAGE_ROOT: path.join(monPaths.connectors, "packages"),
      EDEN_AGENT_CONNECTOR_DATA_ROOT: path.join(monPaths.connectors, "runtime"),
      EDEN_AGENT_USER_AGENT_ROOT: monPaths.agents,
      EDEN_AGENT_REALM_MIGRATION_MARKER: monPaths.migrationMarker,
      ...monRuntimeEnvironmentExclusions,
    })
  }
  if (!reuseLocalServer) {
    devLog(`启动尘世 server，端口 ${localServerPort}`)
    localServer = start("server-local", ["run", "dev:server"], {
      EDEN_AGENT_RUNTIME_ORIGIN: "local",
      EDEN_AGENT_BIND: `127.0.0.1:${localServerPort}`,
      EDEN_AGENT_CAPABILITY_TOKEN: capabilityTokens.local,
      EDEN_AGENT_TOKEN_FILE: localPaths.tokenFile,
      EDEN_AGENT_DATABASE: localPaths.database,
      EDEN_AGENT_BLOB_ROOT: localPaths.blobs,
      EDEN_AGENT_LOG_DIRECTORY: localPaths.logs,
      EDEN_AGENT_PLUGIN_ROOT: localPaths.plugins,
      EDEN_AGENT_SKILL_INSTALL_ROOT: localPaths.skills,
      EDEN_AGENT_CONNECTOR_PACKAGE_ROOT: path.join(localPaths.connectors, "packages"),
      EDEN_AGENT_CONNECTOR_DATA_ROOT: path.join(localPaths.connectors, "runtime"),
      EDEN_AGENT_USER_AGENT_ROOT: localPaths.agents,
      EDEN_AGENT_REALM_MIGRATION_MARKER: localPaths.migrationMarker,
      MON_CORE_BASE_URL: undefined,
      MON_CORE_TOKEN: undefined,
      EDEN_AGENT_LEGACY_CORE_DATABASE: path.join(localPaths.dataRoot, "no-legacy-core.db"),
      ...localRuntimeEnvironment,
    })
  }
  await Promise.all([
    waitFor(`http://127.0.0.1:${serverPort}/readyz`, "伊甸园 server", monServer, serverReadyTimeoutMs),
    waitFor(`http://127.0.0.1:${localServerPort}/readyz`, "尘世 server", localServer, serverReadyTimeoutMs),
  ])

  devLog(`启动 web，端口 ${webPort}`)
  const web = start("web", ["run", "dev:web"], {
    VITE_EDEN_AGENT_MON_BASE_URL: `http://127.0.0.1:${serverPort}`,
    VITE_EDEN_AGENT_LOCAL_BASE_URL: `http://127.0.0.1:${localServerPort}`,
    VITE_EDEN_AGENT_MON_CAPABILITY_TOKEN: capabilityTokens.mon,
    VITE_EDEN_AGENT_LOCAL_CAPABILITY_TOKEN: capabilityTokens.local,
  })
  await waitFor(`http://127.0.0.1:${webPort}`, "web", web, webReadyTimeoutMs)

  devLog("启动 desktop")
  // A previous externally managed desktop may write its quit flag while this
  // launcher is taking over the old ports.  It does not belong to the new
  // process tree, so only arm observation after the replacement is spawned.
  rmSync(quitFlag, { force: true })
  const desktop = start("desktop", ["run", "dev:desktop"], {
    ELECTRON_RUN_AS_NODE: undefined,
    EDEN_AGENT_MON_PORT: String(serverPort),
    EDEN_AGENT_LOCAL_PORT: String(localServerPort),
    EDEN_AGENT_MON_CAPABILITY_TOKEN: capabilityTokens.mon,
    EDEN_AGENT_LOCAL_CAPABILITY_TOKEN: capabilityTokens.local,
    EDEN_AGENT_DEV_PARENT_PID: String(process.pid),
  })
  quitWatcherArmed = true

  devLog("已启动：伊甸园 server / 尘世 server / web / desktop。按 Ctrl+C 退出全部进程。")
  desktop.on("exit", () => void shutdown(0))
} catch (error) {
  process.stderr.write(`${labelText("dev")} ${error instanceof Error ? error.message : String(error)}\n`)
  await shutdown(1)
}

import net from "node:net"
import { spawn } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { loadMonConfig } from "./monconfig.mjs"

const root = process.cwd()
const config = loadMonConfig(root)
const serverPort = config.number("server", "PORT", 40092)
const webPort = config.number("server", "WEB_PORT", 40091)
const quitFlag = config.path("desktop", "QUIT_FLAG", ".artifacts/desktop-quit.flag")

rmSync(quitFlag, { force: true })

const children = []
let shuttingDown = false

const ansi = {
  reset: "\x1b[0m",
  dev: "\x1b[90m",
  server: "\x1b[36m",
  web: "\x1b[35m",
  desktop: "\x1b[32m",
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm"
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function labelText(label) {
  const color = label === "server" ? ansi.server : label === "web" ? ansi.web : label === "desktop" ? ansi.desktop : ansi.dev
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
    const child = spawn(cmd[0], cmd.slice(1), { cwd: root, stdio: "ignore", windowsHide: true })
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
    const child = spawn(cmd[0], cmd.slice(1), { cwd: root, stdout: "pipe", stderr: "pipe", windowsHide: true })
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
      return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim()
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

function start(label, cmd, extraEnv = {}) {
  const child = spawn(cmd[0], cmd.slice(1), {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: childEnv(extraEnv),
    detached: process.platform !== "win32",
    windowsHide: true,
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

  return child
}

async function waitFor(url, label, child) {
  let exited = false
  let exitCode = null
  if (child) {
    child.on("exit", (code) => {
      exited = true
      exitCode = code
    })
  }

  for (let i = 0; i < 60; i += 1) {
    if (exited) {
      throw new Error(`${label} 启动进程已退出，退出码：${exitCode}`)
    }
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 304) return
    } catch {}
    await sleep(500)
  }
  throw new Error(`${label} 未在 30s 内就绪：${url}`)
}

function assertPortFree(port, label) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once("error", () => reject(new Error(`${label} 端口 ${port} 已被占用，请先退出旧的 MonAgent 进程或释放该端口。`)))
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve())
    })
  })
}

async function ensurePortFree(port, label) {
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

const quitWatcher = setInterval(() => {
  if (existsSync(quitFlag)) {
    devLog("检测到桌面退出标记，正在退出 server / web / desktop")
    void shutdown(0)
  }
}, 500)
quitWatcher.unref?.()

try {
  await ensurePortFree(serverPort, "server")
  await ensurePortFree(webPort, "web")

  devLog(`启动 server，端口 ${serverPort}`)
  const server = start("server", [npmCommand(), "run", "dev:server"])
  await waitFor(`http://127.0.0.1:${serverPort}/api/tools/status`, "server", server)

  devLog(`启动 web，端口 ${webPort}`)
  const web = start("web", [npmCommand(), "run", "dev:web"])
  await waitFor(`http://127.0.0.1:${webPort}`, "web", web)

  devLog("启动 desktop")
  const desktop = start("desktop", [npmCommand(), "run", "dev:desktop"], { ELECTRON_RUN_AS_NODE: undefined })

  devLog("已启动：server / web / desktop。按 Ctrl+C 退出全部进程。")
  desktop.on("exit", () => void shutdown(0))
} catch (error) {
  process.stderr.write(`${labelText("dev")} ${error instanceof Error ? error.message : String(error)}\n`)
  await shutdown(1)
}

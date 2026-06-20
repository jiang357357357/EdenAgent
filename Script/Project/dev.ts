import { spawn } from "bun"
import { existsSync, rmSync } from "node:fs"

const root = process.cwd()
const { loadMonConfig } = await import("./monconfig")
const config = loadMonConfig(root)
const serverPort = config.number("server", "PORT", 40092)
const webPort = config.number("server", "WEB_PORT", 40091)
const quitFlag = config.path("desktop", "QUIT_FLAG", ".artifacts/desktop-quit.flag")
const bunExe = process.execPath

rmSync(quitFlag, { force: true })

type Child = ReturnType<typeof spawn>

const children: Child[] = []
let shuttingDown = false

const ansi = {
  reset: "\x1b[0m",
  dev: "\x1b[90m",
  server: "\x1b[36m",
  web: "\x1b[35m",
  desktop: "\x1b[32m",
}

function labelText(label: string) {
  const color =
    label === "server" ? ansi.server :
    label === "web" ? ansi.web :
    label === "desktop" ? ansi.desktop :
    ansi.dev
  return `${color}[${label}]${ansi.reset}`
}

function devLog(message: string) {
  console.log(`${labelText("dev")} ${message}`)
}

function writeLine(label: string, line: string, stream: "stdout" | "stderr") {
  if (!line) return
  const target = stream === "stderr" ? process.stderr : process.stdout
  target.write(`${labelText(label)} ${line}\n`)
}

async function prefixOutput(label: string, readable: ReadableStream<Uint8Array> | null, stream: "stdout" | "stderr") {
  if (!readable) return

  const decoder = new TextDecoder()
  const reader = readable.getReader()
  let pending = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    pending += decoder.decode(value, { stream: true })
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ""
    for (const line of lines) writeLine(label, line, stream)
  }

  pending += decoder.decode()
  if (pending) writeLine(label, pending, stream)
}

async function runWithTimeout(cmd: string[], timeoutMs: number) {
  const child = spawn({
    cmd,
    cwd: root,
    stdout: "ignore",
    stderr: "ignore",
  })
  const timer = setTimeout(() => {
    child.kill()
  }, timeoutMs)
  try {
    await child.exited
  } finally {
    clearTimeout(timer)
  }
}

async function runCapture(cmd: string[], timeoutMs = 3000) {
  const child = spawn({
    cmd,
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  const timer = setTimeout(() => {
    child.kill()
  }, timeoutMs)
  try {
    const [stdout, stderr] = await Promise.all([
      child.stdout ? new Response(child.stdout).text() : "",
      child.stderr ? new Response(child.stderr).text() : "",
    ])
    const exitCode = await child.exited
    return { stdout, stderr, exitCode }
  } finally {
    clearTimeout(timer)
  }
}

async function killProcessTree(proc: Child | undefined) {
  if (!proc?.pid) return
  proc.kill()
  if (process.platform === "win32") {
    await runWithTimeout(["taskkill", "/PID", String(proc.pid), "/T", "/F"], 3000).catch(() => {})
  }
}

async function killPidTree(pid: number) {
  if (!Number.isFinite(pid) || pid <= 0) return
  if (process.platform === "win32") {
    await runWithTimeout(["taskkill", "/PID", String(pid), "/T", "/F"], 3000).catch(() => {})
    return
  }
  try {
    process.kill(pid)
  } catch {}
}

async function portPids(port: number) {
  if (process.platform !== "win32") return []
  const result = await runCapture(["netstat", "-ano"], 5000).catch(() => ({ stdout: "", stderr: "", exitCode: 1 }))
  const pids = new Set<number>()
  const pattern = new RegExp(`(?:0\\.0\\.0\\.0|127\\.0\\.0\\.1|\\[?::\\]?):${port}\\s+.*\\s+LISTENING\\s+(\\d+)`, "i")
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(pattern)
    const pid = match ? Number(match[1]) : NaN
    if (Number.isFinite(pid)) pids.add(pid)
  }
  return [...pids]
}

async function processCommandLine(pid: number) {
  if (process.platform !== "win32") return ""
  const script = `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -ExpandProperty CommandLine`
  const result = await runCapture(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], 5000).catch(() => ({
    stdout: "",
    stderr: "",
    exitCode: 1,
  }))
  return result.stdout.trim()
}

async function releaseOwnedPort(port: number, label: string) {
  const pids = await portPids(port)
  if (!pids.length) return

  for (const pid of pids) {
    const commandLine = await processCommandLine(pid)
    devLog(`清理占用 ${label} 端口 ${port} 的进程，PID ${pid}${commandLine ? `：${commandLine}` : ""}`)
    await killPidTree(pid)
  }

  for (let index = 0; index < 20; index += 1) {
    if (!(await portPids(port)).length) return
    await Bun.sleep(250)
  }
}

function start(label: string, cmd: string[]) {
  const child = spawn({
    cmd,
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })
  children.push(child)

  void prefixOutput(label, child.stdout, "stdout")
  void prefixOutput(label, child.stderr, "stderr")
  void child.exited.then((code) => {
    if (!shuttingDown && code !== 0) {
      process.stderr.write(`${labelText("dev")} ${label} exited with code ${code}\n`)
      shutdown(code)
    }
  })

  return child
}

async function waitFor(url: string, label: string, child?: Child) {
  let exited = false
  let exitCode: number | null = null
  if (child) {
    void child.exited.then((code) => {
      exited = true
      exitCode = code
    })
  }

  for (let i = 0; i < 60; i++) {
    if (exited) {
      throw new Error(`${label} 启动进程已退出，退出码：${exitCode}`)
    }
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 304) return
    } catch {}
    await Bun.sleep(500)
  }
  throw new Error(`${label} 未在 30s 内就绪：${url}`)
}

function assertPortFree(port: number, label: string) {
  try {
    const probe = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: {
        data() {},
      },
    })
    probe.stop(true)
  } catch {
    throw new Error(`${label} 端口 ${port} 已被占用，请先退出旧的 MonAgent 进程或释放该端口。`)
  }
}

async function ensurePortFree(port: number, label: string) {
  await releaseOwnedPort(port, label)
  assertPortFree(port, label)
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
  const server = start("server", [bunExe, "run", "dev:server"])
  await waitFor(`http://127.0.0.1:${serverPort}/api/tools/status`, "server", server)

  devLog(`启动 web，端口 ${webPort}`)
  const web = start("web", [bunExe, "run", "dev:web"])
  await waitFor(`http://127.0.0.1:${webPort}`, "web", web)

  devLog("启动 desktop")
  const desktop = start("desktop", [bunExe, "run", "Script/Project/dev-desktop.ts"])

  devLog("已启动：server / web / desktop。按 Ctrl+C 退出全部进程。")
  await desktop.exited
  await shutdown(0)
} catch (error) {
  process.stderr.write(`${labelText("dev")} ${error instanceof Error ? error.message : String(error)}\n`)
  await shutdown(1)
}

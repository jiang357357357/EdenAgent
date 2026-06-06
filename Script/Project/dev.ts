import { spawn } from "bun"

const root = process.cwd()
const { loadMonConfig } = await import("./monconfig")
const config = loadMonConfig(root)
const serverPort = config.number("server", "PORT", 40092)
const webPort = config.number("server", "WEB_PORT", 40091)
const bunExe = process.execPath

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

function killProcessTree(proc: Child | undefined) {
  if (!proc?.pid) return
  if (process.platform === "win32") {
    Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    return
  }
  proc.kill()
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

async function waitFor(url: string, label: string) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 304) return
    } catch {}
    await Bun.sleep(500)
  }
  throw new Error(`${label} 未在 30s 内就绪：${url}`)
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of [...children].reverse()) killProcessTree(child)
  process.exit(code)
}

process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))

devLog(`启动 server，端口 ${serverPort}`)
start("server", [bunExe, "run", "dev:server"])
await waitFor(`http://127.0.0.1:${serverPort}/api/tools/status`, "server")

devLog(`启动 web，端口 ${webPort}`)
start("web", [bunExe, "run", "dev:web"])
await waitFor(`http://127.0.0.1:${webPort}`, "web")

devLog("启动 desktop")
const desktop = start("desktop", [bunExe, "run", "Script/Project/dev-desktop.ts"])

devLog("已启动：server / web / desktop。按 Ctrl+C 退出全部进程。")
await desktop.exited
shutdown(0)

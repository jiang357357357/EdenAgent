import path from "node:path"
import { rm } from "node:fs/promises"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { spawn } from "bun"
import { loadMonConfig } from "./monconfig"

const root = process.cwd()
const config = loadMonConfig(root)
const webPort = config.number("server", "WEB_PORT", 40091)
const quitFlag = config.path("desktop", "QUIT_FLAG", ".artifacts/desktop-quit.flag")
const bunExe = process.execPath

await rm(quitFlag, { force: true }).catch(() => {})

async function waitForVite() {
  console.log("\n  等待 Vite 就绪后启动桌面应用...\n")
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${webPort}`)
      if (res.ok || res.status === 304) return
    } catch {}
    await Bun.sleep(1000)
  }
  throw new Error("Vite 未在 60s 内就绪")
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

async function killProcessTree(proc: ReturnType<typeof spawn> | undefined) {
  if (!proc?.pid) return
  proc.kill()
  if (process.platform === "win32") {
    await runWithTimeout(["taskkill", "/PID", String(proc.pid), "/T", "/F"], 3000).catch(() => {})
  }
}

function requestDesktopQuit() {
  mkdirSync(path.dirname(quitFlag), { recursive: true })
  writeFileSync(quitFlag, String(Date.now()))

  if (process.platform !== "win32") {
    desktopProc?.kill()
    return
  }
}

let cleaned = false
let desktopProc: ReturnType<typeof spawn> | undefined

async function relay(readable: ReadableStream<Uint8Array> | null, target: NodeJS.WriteStream) {
  if (!readable) return

  const reader = readable.getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    target.write(value)
  }
}

async function cleanup() {
  if (cleaned) return
  cleaned = true
  requestDesktopQuit()
  await Bun.sleep(2500)
  await killProcessTree(desktopProc)
  rmSync(quitFlag, { force: true })
}

process.on("SIGINT", () => {
  void cleanup().finally(() => process.exit())
})
process.on("SIGTERM", () => {
  void cleanup().finally(() => process.exit())
})

await waitForVite()

desktopProc = spawn({
  cmd: [bunExe, "run", "--cwd", "frontend/desktop", "dev"],
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...process.env,
    MON_AGENT_DESKTOP_QUIT_FLAG: quitFlag,
  },
})

void relay(desktopProc.stdout, process.stdout)
void relay(desktopProc.stderr, process.stderr)

await desktopProc.exited
await cleanup()

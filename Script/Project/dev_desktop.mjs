import path from "node:path"
import { rm } from "node:fs/promises"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { spawnExecutable, spawnNpm } from "../../frontend/Script/Project/process_runner.mjs"
import { loadMonConfig } from "./monconfig.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const config = loadMonConfig(root)
const webPort = Number(process.env.MON_AGENT_WEB_PORT ?? config.number("server", "WEB_PORT", 40091))
const quitFlag = config.path("desktop", "QUIT_FLAG", ".artifacts/desktop-quit.flag")

await rm(quitFlag, { force: true }).catch(() => {})

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function isWebReady() {
  try {
    const res = await fetch(`http://127.0.0.1:${webPort}`)
    return res.ok || res.status === 304
  } catch {
    return false
  }
}

async function waitForVite(webProc) {
  console.log("\n  等待 Web 前端就绪后启动桌面应用...\n")
  let exited = false
  let exitCode = null
  if (webProc) {
    webProc.on("exit", (code) => {
      exited = true
      exitCode = code
    })
  }
  for (let i = 0; i < 60; i += 1) {
    if (exited) {
      throw new Error(`Web 前端启动进程已退出，退出码：${exitCode}`)
    }
    try {
      const res = await fetch(`http://127.0.0.1:${webPort}`)
      if (res.ok || res.status === 304) return
    } catch {}
    await sleep(1000)
  }
  throw new Error("Vite 未在 60s 内就绪")
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

function requestDesktopQuit() {
  mkdirSync(path.dirname(quitFlag), { recursive: true })
  writeFileSync(quitFlag, String(Date.now()))

  if (process.platform !== "win32") {
    void killProcessTree(desktopProc)
  }
}

let cleaned = false
let webProc
let desktopProc

function handleOutputError(error) {
  if (error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED") {
    void cleanup().finally(() => process.exit(0))
    return
  }
  setImmediate(() => { throw error })
}

process.stdout.on("error", handleOutputError)
process.stderr.on("error", handleOutputError)

function relay(readable, target) {
  if (!readable) return
  readable.on("data", (chunk) => target.write(chunk))
}

function handleChildError(label, child) {
  child.on("error", (error) => {
    process.stderr.write(`[dev] 无法启动 ${label}: ${error.message}\n`)
    void cleanup().finally(() => process.exit(1))
  })
}

async function cleanup() {
  if (cleaned) return
  cleaned = true
  requestDesktopQuit()
  await sleep(2500)
  await killProcessTree(desktopProc)
  await killProcessTree(webProc)
  rmSync(quitFlag, { force: true })
}

process.on("SIGINT", () => {
  void cleanup().finally(() => process.exit())
})
process.on("SIGTERM", () => {
  void cleanup().finally(() => process.exit())
})
if (process.platform !== "win32") {
  process.on("SIGHUP", () => {
    void cleanup().finally(() => process.exit())
  })
}

if (await isWebReady()) {
  console.log(`\n  Web 前端已就绪：http://127.0.0.1:${webPort}\n`)
} else {
  console.log(`\n  启动 Web 前端：http://127.0.0.1:${webPort}\n`)
  webProc = spawnNpm(["run", "dev:web"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    detached: process.platform !== "win32",
  })
  handleChildError("web", webProc)
  relay(webProc.stdout, process.stdout)
  relay(webProc.stderr, process.stderr)
  await waitForVite(webProc)
}

const desktopEnvironment = {
  ...process.env,
  MON_AGENT_DESKTOP_QUIT_FLAG: quitFlag,
  MON_AGENT_DEV_PARENT_PID: process.env.MON_AGENT_DEV_PARENT_PID || String(process.pid),
  MON_AGENT_SERVER_MODE: "external",
  MON_AGENT_TOKEN_FILE: process.env.MON_AGENT_TOKEN_FILE || path.join(root, "Data", "server-capability.token"),
}
// Electron switches into plain Node mode when this inherited variable is set.
// The standalone desktop launcher must clear it just like the full dev launcher.
delete desktopEnvironment.ELECTRON_RUN_AS_NODE

desktopProc = spawnNpm(["--prefix", "frontend/desktop", "run", "dev"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: desktopEnvironment,
  detached: process.platform !== "win32",
})

handleChildError("desktop", desktopProc)
relay(desktopProc.stdout, process.stdout)
relay(desktopProc.stderr, process.stderr)

desktopProc.on("exit", () => {
  void cleanup().finally(() => process.exit())
})

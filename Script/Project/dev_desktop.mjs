import path from "node:path"
import { spawn } from "node:child_process"
import { rm } from "node:fs/promises"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { loadMonConfig } from "./monconfig.mjs"

const root = process.cwd()
const config = loadMonConfig(root)
const webPort = config.number("server", "WEB_PORT", 40091)
const quitFlag = config.path("desktop", "QUIT_FLAG", ".artifacts/desktop-quit.flag")

await rm(quitFlag, { force: true }).catch(() => {})

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm"
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForVite() {
  console.log("\n  等待 Vite 就绪后启动桌面应用...\n")
  for (let i = 0; i < 60; i += 1) {
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
let desktopProc

function relay(readable, target) {
  if (!readable) return
  readable.on("data", (chunk) => target.write(chunk))
}

async function cleanup() {
  if (cleaned) return
  cleaned = true
  requestDesktopQuit()
  await sleep(2500)
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

desktopProc = spawn(npmCommand(), ["--prefix", "frontend/desktop", "run", "dev"], {
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...process.env,
    MON_AGENT_DESKTOP_QUIT_FLAG: quitFlag,
  },
  detached: process.platform !== "win32",
  windowsHide: true,
})

relay(desktopProc.stdout, process.stdout)
relay(desktopProc.stderr, process.stderr)

desktopProc.on("exit", () => {
  void cleanup().finally(() => process.exit())
})

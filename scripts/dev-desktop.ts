import path from "node:path"
import { mkdir, rm } from "node:fs/promises"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { spawn } from "bun"
import { loadMonConfig } from "./monconfig"

const root = process.cwd()
const config = loadMonConfig(root)
const webPort = config.number("server", "WEB_PORT", 40081)
const quitFlag = config.path("desktop", "QUIT_FLAG", ".artifacts/desktop-quit.flag")

await rm(quitFlag, { force: true }).catch(() => {})

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

async function waitForVite() {
  console.log("\n  等待 Vite 就绪后启动桌面应用...\n")
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${webPort}`)
      if (res.ok || res.status === 304) return
    } catch {}
    await Bun.sleep(1000)
  }
  throw new Error("Vite 未在 60s 内就绪")
}

function killProcessTree(proc: ReturnType<typeof spawn> | undefined) {
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

function requestDesktopQuitSync() {
  mkdirSync(path.dirname(quitFlag), { recursive: true })
  writeFileSync(quitFlag, String(Date.now()))

  if (process.platform !== "win32") {
    desktopProc?.kill()
    return
  }

  const escapedRoot = root.replaceAll("'", "''")
  const script = `
$root = '${escapedRoot}'
$targets = Get-CimInstance Win32_Process | Where-Object {
  ($_.ExecutablePath -like "$root*") -and
  ($_.Name -eq "opencode-desktop.exe" -or $_.CommandLine -like "*target\\\\debug\\\\opencode-desktop.exe*")
} | Select-Object -ExpandProperty ProcessId -Unique

foreach ($id in $targets) {
  taskkill /PID $id /T | Out-Null
}
`

  Bun.spawnSync(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    stdout: "ignore",
    stderr: "ignore",
  })
}

function killDesktopProjectProcesses() {
  if (process.platform !== "win32") return

  const escapedRoot = root.replaceAll("'", "''")
  const script = `
$root = '${escapedRoot}'
$current = $PID
$targets = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $current -and (
    ($_.ExecutablePath -like "$root*") -or
    ($_.CommandLine -like "*--cwd packages/desktop dev*") -or
    ($_.CommandLine -like "*--cwd packages\\\\desktop dev*") -or
    ($_.CommandLine -like "*packages\\\\desktop\\\\src-tauri*") -or
    ($_.CommandLine -like "*packages/desktop/src-tauri*") -or
    ($_.CommandLine -like "*target\\\\debug\\\\opencode-desktop.exe*") -or
    ($_.CommandLine -like "*target/debug/opencode-desktop.exe*") -or
    ($_.Name -eq "cargo.exe" -and $_.CommandLine -like "*run --no-default-features --color always --*")
  )
} | Select-Object -ExpandProperty ProcessId -Unique

foreach ($id in $targets) {
  taskkill /PID $id /T /F | Out-Null
}
`

  Bun.spawnSync(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    stdout: "ignore",
    stderr: "ignore",
  })
}

let cleaned = false
let desktopProc: ReturnType<typeof spawn> | undefined

function cleanupSync() {
  if (cleaned) return
  cleaned = true
  requestDesktopQuitSync()
  sleepSync(2500)
  killProcessTree(desktopProc)
  sleepSync(400)
  killDesktopProjectProcesses()
  rmSync(quitFlag, { force: true })
}

process.on("SIGINT", () => {
  cleanupSync()
  process.exit()
})
process.on("SIGTERM", () => {
  cleanupSync()
  process.exit()
})
process.on("exit", () => {
  killDesktopProjectProcesses()
})

await waitForVite()

desktopProc = spawn({
  cmd: ["bun", "run", "--cwd", "packages/desktop", "dev"],
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    OPENCODE_DESKTOP_QUIT_FLAG: quitFlag,
  },
})

await desktopProc.exited
cleanupSync()

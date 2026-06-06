import path from "node:path"
import { mkdir, rm } from "node:fs/promises"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { spawn } from "bun"
import { loadMonConfig } from "./monconfig"

const root = process.cwd()
const config = loadMonConfig(root)
const webPort = config.number("server", "WEB_PORT", 40091)
const quitFlag = config.path("desktop", "QUIT_FLAG", ".artifacts/desktop-quit.flag")
const bunExe = process.execPath

await rm(quitFlag, { force: true }).catch(() => {})

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

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
    ($_.Name -eq "mon-agent-desktop.exe" -or $_.CommandLine -like "*target*debug*mon-agent-desktop.exe*")
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
    ($_.Name -eq "mon-agent-desktop.exe" -and $_.ExecutablePath -like "$root*") -or
    ($_.CommandLine -like "*--cwd frontend/desktop dev*") -or
    ($_.CommandLine -like "*--cwd frontend*desktop dev*") -or
    ($_.CommandLine -like "*frontend*desktop*src-tauri*") -or
    ($_.CommandLine -like "*frontend/desktop/src-tauri*") -or
    ($_.CommandLine -like "*target*debug*mon-agent-desktop.exe*") -or
    ($_.CommandLine -like "*target/debug/mon-agent-desktop.exe*") -or
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

function waitForDesktopBinaryUnlock() {
  if (process.platform !== "win32") return

  const exe = path.join(root, "frontend", "desktop", "src-tauri", "target", "debug", "mon-agent-desktop.exe")
  for (let i = 0; i < 12; i++) {
    killDesktopProjectProcesses()
    const result = Bun.spawnSync(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `
$path = '${exe.replaceAll("'", "''")}'
if (!(Test-Path -LiteralPath $path)) { exit 0 }
try {
  $stream = [System.IO.File]::Open($path, 'Open', 'ReadWrite', 'None')
  $stream.Close()
  exit 0
} catch {
  exit 1
}
`], {
      stdout: "ignore",
      stderr: "ignore",
    })
    if (result.exitCode === 0) return
    sleepSync(500)
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
waitForDesktopBinaryUnlock()

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
cleanupSync()

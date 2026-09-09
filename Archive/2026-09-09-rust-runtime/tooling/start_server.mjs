import { spawn } from "node:child_process"
import { constants as osConstants } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const origin = process.env.EDEN_AGENT_RUNTIME_ORIGIN?.trim() || "mon"

if (origin !== "mon" && origin !== "local") {
  throw new Error(`EDEN_AGENT_RUNTIME_ORIGIN must be mon or local, got ${JSON.stringify(origin)}`)
}

const command = process.platform === "win32" ? "powershell.exe" : "bash"
const args = process.platform === "win32"
  ? [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "Script", "Cmd", "Win", "StartServer.ps1"),
      "-RuntimeOrigin",
      origin,
    ]
  : [path.join(root, "Script", "Process", "linux", "server", "run_server.sh")]

const child = spawn(command, args, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
})

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal))
}

child.once("error", (error) => {
  console.error(`[Eden Agent] 无法启动 ${origin} Server：${error.message}`)
  process.exitCode = 1
})

child.once("exit", (code, signal) => {
  if (signal) {
    process.exitCode = 128 + (osConstants.signals[signal] ?? 1)
    return
  }
  process.exitCode = code ?? 1
})

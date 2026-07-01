import path from "node:path"
import { spawn } from "bun"

const root = process.cwd()
const python = process.env.MON_AGENT_PYTHON || process.env.PYTHON || (process.platform === "win32" ? "python" : "python3")
const pythonPath = [
  path.join(root, "Server", "src"),
  path.join(root, "AgentCore", "src"),
  process.env.PYTHONPATH || "",
]
  .filter(Boolean)
  .join(path.delimiter)

async function run(args: string[]) {
  const child = spawn({
    cmd: [python, ...args],
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      PYTHONPATH: pythonPath,
    },
  })
  const code = await child.exited
  if (code !== 0) process.exit(code)
}

await run(["-m", "compileall", "-q", "Server/src"])
await run(["-m", "unittest", "discover", "-s", "Server/tests"])

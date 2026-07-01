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

const child = spawn({
  cmd: [python, "-m", "mon_agent_server"],
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    PYTHONPATH: pythonPath,
  },
})

process.exit(await child.exited)

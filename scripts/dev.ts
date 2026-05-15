const root = process.cwd()
const { loadMonConfig } = await import("./monconfig")
const config = loadMonConfig(root)
const serverPort = config.number("server", "PORT", 40082)
const webPort = config.number("server", "WEB_PORT", 40081)

function psQuote(input: string) {
  return `'${input.replaceAll("'", "''")}'`
}

function openTerminal(title: string, command: string) {
  if (process.platform === "win32") {
    const psCommand = [
      `$Host.UI.RawUI.WindowTitle = ${psQuote(title)}`,
      `Set-Location -LiteralPath ${psQuote(root)}`,
      command,
    ].join("; ")

    Bun.spawnSync(["cmd", "/c", "start", title, "powershell", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", psCommand])
    return
  }

  Bun.spawn({
    cmd: ["sh", "-lc", `cd ${JSON.stringify(root)} && ${command}`],
    stdout: "ignore",
    stderr: "ignore",
  })
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

console.log("启动 server 终端...")
openTerminal("opencode server", "bun run dev:server")
await waitFor(`http://localhost:${serverPort}/session`, "server")

console.log("启动 web 终端...")
openTerminal("opencode web", "bun run dev:web")
await waitFor(`http://localhost:${webPort}`, "web")

console.log("启动 desktop 终端...")
openTerminal("opencode desktop", "bun run scripts/dev-desktop.ts")

console.log("已打开 3 个独立终端：server / web / desktop")

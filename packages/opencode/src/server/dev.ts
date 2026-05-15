import { serve } from "bun"
import { createLogger } from "@opencode-ai/logs"
import { loadMonConfig } from "../../../../scripts/monconfig"

const serverLog = createLogger("Server", "dev")
const config = loadMonConfig()

const PORT = config.number("server", "PORT", 40082)
const VITE_PORT = config.number("server", "WEB_PORT", 40081)
const isDev = !process.env.OPENCODE_PROD

function findPortPids(port: number) {
  const pids = new Set<number>()
  if (process.platform !== "win32") {
    const proc = Bun.spawnSync(["sh", "-c", `lsof -ti :${port} 2>/dev/null`])
    for (const line of proc.stdout.toString().split(/\r?\n/)) {
      const pid = Number(line.trim())
      if (Number.isInteger(pid) && pid > 0) pids.add(pid)
    }
    return [...pids]
  }

  const netstat = Bun.spawnSync(["netstat", "-ano"])
  const output = netstat.stdout.toString()
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5 || parts[0] !== "TCP") continue
    const [, localAddress, , state, pidText] = parts
    if (state !== "LISTENING" || !localAddress.endsWith(`:${port}`)) continue
    const pid = Number(pidText)
    if (Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  return [...pids]
}

async function waitForPortFree(port: number, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (findPortPids(port).length === 0) return true
    await Bun.sleep(100)
  }
  return findPortPids(port).length === 0
}

async function killPort(port: number) {
  const pids = findPortPids(port).filter((pid) => pid !== process.pid)
  if (pids.length === 0) return

  for (const pid of pids) {
    serverLog.warn(`清理端口 ${port} 上的旧进程 (PID: ${pid})`)
    const proc =
      process.platform === "win32"
        ? Bun.spawnSync(["taskkill", "/T", "/F", "/PID", String(pid)])
        : Bun.spawnSync(["kill", "-9", String(pid)])

    if (proc.exitCode !== 0) {
      const message = `${proc.stderr.toString().trim()} ${proc.stdout.toString().trim()}`.trim()
      throw new Error(`无法清理端口 ${port} 上的进程 PID ${pid}${message ? `: ${message}` : ""}`)
    }
  }

  if (!(await waitForPortFree(port))) {
    throw new Error(`端口 ${port} 仍被占用: ${findPortPids(port).join(", ")}`)
  }
}

async function main() {
  serverLog.info("opencode dev server starting...")

  await killPort(PORT)

  let server: ReturnType<typeof serve> | undefined

  // The desktop and web dev servers both expect the configured backend port.
  for (const port of [PORT]) {
    try {
      server = serve({
        port,
        idleTimeout: 0,
        async fetch(req) {
          const url = new URL(req.url)

          // Proxy API calls to the Effect HTTP server (strip /api prefix for v1 routes)
          if (url.pathname.startsWith("/api/")) {
            try {
              const { Server } = await import("@/server/server")
              const targetUrl = new URL(req.url)
              targetUrl.pathname = url.pathname.replace("/api", "")
              const proxyReq = new Request(targetUrl, {
                method: req.method,
                headers: req.headers,
                body: req.body,
              })
              return Server.Default().app.fetch(proxyReq)
            } catch (err) {
              return new Response(
                JSON.stringify({ error: "API server not available", detail: String(err) }),
                { status: 503, headers: { "content-type": "application/json" } },
              )
            }
          }

          // SSE endpoint
          if (url.pathname === "/api/events") {
            return handleSSE(req)
          }

          // In dev, proxy to Vite
          if (isDev) {
            try {
              const viteUrl = `http://localhost:${VITE_PORT}${url.pathname}${url.search}`
              const res = await fetch(viteUrl)
              return res
            } catch {
              return new Response(`Vite dev server not running on :${VITE_PORT}. Run: bun dev:web`, { status: 503 })
            }
          }

          // In production, serve static files from web/dist
          const filePath = `packages/web/dist${url.pathname === "/" ? "/index.html" : url.pathname}`
          const file = Bun.file(filePath)
          if (await file.exists()) {
            return new Response(file, {
              headers: { "content-type": getContentType(filePath) },
            })
          }
          return new Response("Not found", { status: 404 })
        },
      })
      serverLog.info(`Listening on http://localhost:${server.port}`)
      if (isDev) {
        serverLog.debug(`API + Web proxy to Vite :${VITE_PORT}`)
      }
      break
    } catch (err: any) {
      throw err
    }
  }
}

function handleSSE(req: Request): Response {
  const stream = new ReadableStream({
    start(controller) {
      const interval = setInterval(() => {
        controller.enqueue(`data: ${JSON.stringify({ type: "ping", time: Date.now() })}\n\n`)
      }, 15000)
      req.signal.addEventListener("abort", () => clearInterval(interval))
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  })
}

function getContentType(path: string): string {
  const ext = path.split(".").pop()
  const types: Record<string, string> = {
    html: "text/html",
    js: "text/javascript",
    css: "text/css",
    json: "application/json",
    png: "image/png",
    svg: "image/svg+xml",
    ico: "image/x-icon",
  }
  return types[ext ?? ""] ?? "application/octet-stream"
}

main()

import { serve } from "bun"
import { createAgentApp } from "./app/bootstrap"
import { loadAgentServerConfig } from "./app/config"
import { CoreAuthenticationExpiredError } from "./core"
import { readAuthToken, requireCoreToken } from "./core/auth"
import { HubRegistryClient } from "./hub"
import { proxyToVite } from "./http/dev-proxy"
import { eventStreamResponse, jsonResponse, notFoundResponse, readJsonBody, stripApiPrefix } from "./http/response"
import { isAgentApiRoute } from "./http/routes"
import { runSelfAwake, type SelfAwakeRequest } from "./self-awake"
import type { PermissionReply, PromptPart } from "./types"

const config = loadAgentServerConfig()
const { logger, events, permissions, questions, store, sessionHydrator, coreClient, runtime } =
  createAgentApp(config)
const hubRegistry = new HubRegistryClient(config, logger)

async function ensureRuntimeSession(request: Request, sessionID: string) {
  return sessionHydrator.ensure(requireCoreToken(request), sessionID)
}

async function handleApi(request: Request, url: URL) {
  if (request.method === "OPTIONS") {
    logger.debug("preflight 已处理", { path: url.pathname })
    return jsonResponse(true)
  }

  if (request.method === "GET" && url.pathname === "/global/event") {
    logger.info("事件流已打开", { path: url.pathname })
    return eventStreamResponse(events.stream(request.signal))
  }

  if (request.method === "GET" && url.pathname === "/session") {
    const token = requireCoreToken(request)
    const sessions = await coreClient.listAgentSessions(token, Number(url.searchParams.get("limit") ?? 50))
    for (const session of sessions) {
      store.upsertSessionInfo(session)
    }
    return jsonResponse(sessions)
  }

  if (request.method === "POST" && url.pathname === "/session") {
    const token = requireCoreToken(request)
    const body = await readJsonBody<{ title?: string }>(request)
    const session = store.createSession(body.title)
    sessionHydrator.markHydrated(session.id)
    await coreClient.syncAgentSession(token, session)
    logger.info("session 已创建", { sessionID: session.id, title: session.title })
    events.emit({ type: "session.created", properties: { sessionID: session.id, info: session } })
    return jsonResponse(session)
  }

  const messageMatch = url.pathname.match(/^\/session\/([^/]+)\/message$/)
  if (messageMatch && request.method === "GET") {
    const sessionID = decodeURIComponent(messageMatch[1] ?? "")
    const token = requireCoreToken(request)
    if (!runtime.isRunning(sessionID)) {
      await sessionHydrator.hydrate(token, sessionID)
    } else {
      await sessionHydrator.ensure(token, sessionID)
    }
    return jsonResponse(store.listMessages(sessionID, Number(url.searchParams.get("limit") ?? 100)))
  }

  if (messageMatch && request.method === "POST") {
    const sessionID = decodeURIComponent(messageMatch[1] ?? "")
    const token = requireCoreToken(request)
    const body = await readJsonBody<{ parts?: PromptPart[] }>(request)
    logger.info("消息追加请求已收到", { sessionID, parts: body.parts?.length ?? 0 })
    await ensureRuntimeSession(request, sessionID)
    const message = runtime.appendUserOnly(sessionID, body.parts ?? [])
    const session = store.requireSession(sessionID)
    await coreClient.syncAgentMessage(token, session.info, message)
    return jsonResponse(true)
  }

  const promptMatch = url.pathname.match(/^\/session\/([^/]+)\/prompt_async$/)
  if (promptMatch && request.method === "POST") {
    const sessionID = decodeURIComponent(promptMatch[1] ?? "")
    const body = await readJsonBody<{ parts?: PromptPart[] }>(request)
    logger.info("提示词请求已收到", { sessionID, parts: body.parts?.length ?? 0 })
    await ensureRuntimeSession(request, sessionID)
    await runtime.promptAsync(sessionID, body.parts ?? [], requireCoreToken(request))
    return jsonResponse(true)
  }

  if (request.method === "GET" && url.pathname === "/permission") {
    return jsonResponse(permissions.list())
  }

  const permissionReplyMatch = url.pathname.match(/^\/permission\/([^/]+)\/reply$/)
  if (permissionReplyMatch && request.method === "POST") {
    const requestID = decodeURIComponent(permissionReplyMatch[1] ?? "")
    const body = await readJsonBody<{ reply?: PermissionReply; message?: string }>(request)
    logger.info("权限回复请求已收到", { requestID, reply: body.reply ?? "reject" })
    return jsonResponse(permissions.reply(requestID, body.reply ?? "reject", body.message))
  }

  if (request.method === "GET" && url.pathname === "/question") {
    return jsonResponse(questions.list())
  }

  if (request.method === "GET" && url.pathname === "/tools/status") {
    return jsonResponse({
      search: {
        status: "online",
        provider: "duckduckgo",
        mode: "embedded",
        label: "DuckDuckGo",
        message: "DuckDuckGo 内置搜索可用，不需要 Docker、Python 或外部搜索服务。",
      },
      tools: {
        search: "web_search",
        fetch: "web_fetch",
      },
    })
  }

  if (request.method === "POST" && url.pathname === "/internal/self-awake/run") {
    const body = await readJsonBody<SelfAwakeRequest>(request)
    const token = readAuthToken(request)
    const decision = await runSelfAwake(body, logger, {
      coreToken: token,
      resolveCoreConfig: (coreToken) => coreClient.resolveRuntimeConfig(coreToken),
      workspaceRoot: config.workspaceRoot,
    })
    return jsonResponse(decision)
  }

  const questionReplyMatch = url.pathname.match(/^\/question\/([^/]+)\/reply$/)
  if (questionReplyMatch && request.method === "POST") {
    const requestID = decodeURIComponent(questionReplyMatch[1] ?? "")
    const body = await readJsonBody<{ answers?: string[][] }>(request)
    logger.info("问题回复请求已收到", { requestID, answerGroups: body.answers?.length ?? 0 })
    return jsonResponse(questions.reply(requestID, body.answers ?? []))
  }

  const questionRejectMatch = url.pathname.match(/^\/question\/([^/]+)\/reject$/)
  if (questionRejectMatch && request.method === "POST") {
    const requestID = decodeURIComponent(questionRejectMatch[1] ?? "")
    logger.info("问题拒绝请求已收到", { requestID })
    return jsonResponse(questions.reject(requestID))
  }

  return notFoundResponse()
}

const server = serve({
  hostname: config.host,
  port: config.port,
  idleTimeout: 0,
  async fetch(request) {
    // Access log is intentionally muted because the frontend polls session/message
    // endpoints frequently in dev mode. Keep business/runtime logs readable.
    // const started = performance.now()
    // const method = request.method
    // let pathname = ""
    // let status = 500
    // let shouldLog = false

    try {
      const url = stripApiPrefix(new URL(request.url))
      // pathname = `${url.pathname}${url.search}`
      const isApiRoute = isAgentApiRoute(url.pathname)
      // shouldLog = isApiRoute || request.method !== "GET"

      if (isApiRoute || request.method !== "GET") {
        const response = await handleApi(request, url)
        // status = response.status
        return response
      }

      if (config.isDev) {
        const response = await proxyToVite(url, config.vitePort)
        // status = response.status
        return response
      }
      const response = notFoundResponse()
      // status = response.status
      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof CoreAuthenticationExpiredError) {
        const payload = {
          path: error.path,
          status: error.status,
          detail: error.detail,
        }
        if (error.detail !== "not_authenticated") {
          logger.warn("Core 认证未通过", payload)
        }
        return jsonResponse(
          {
            error: message,
            code: "core_authentication_expired",
            path: error.path,
            detail: error.detail,
          },
          error.status,
        )
      }
      logger.error("请求处理失败", error)
      const response = jsonResponse({ error: message }, 500)
      // status = response.status
      return response
    }
    // finally {
    //   if (shouldLog) {
    //     const durationMs = Math.round(performance.now() - started)
    //     const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info"
    //     logger[level](`${method} ${pathname || request.url} -> ${status} ${durationMs}ms`)
    //   }
    // }
  },
})

void hubRegistry.start()

async function shutdown(signal: string) {
  logger.info("Agent server 正在退出", { signal })
  await hubRegistry.stop(signal)
  server.stop(true)
  process.exit(0)
}

process.once("SIGINT", () => void shutdown("SIGINT"))
process.once("SIGTERM", () => void shutdown("SIGTERM"))

logger.info(`Agent server 正在监听 http://${config.host}:${config.port}`)
logger.info(`工作区路径：${config.workspaceRoot}`)
logger.info("session 存储：Core Server（当前进程仅保留运行期内存缓存）")
logger.info(`Core 地址：${coreClient.baseUrl}`)
logger.info("搜索提供方：DuckDuckGo 内置搜索")

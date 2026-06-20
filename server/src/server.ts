import { serve } from "bun"
import { createAgentApp } from "./app/bootstrap"
import { loadAgentServerConfig } from "./app/config"
import { CoreAuthenticationExpiredError } from "./core"
import { readAuthToken, requireCoreToken } from "./core/auth"
import { HubRegistryClient } from "./hub"
import { proxyToVite } from "./http/dev-proxy"
import { eventStreamResponse, jsonResponse, notFoundResponse, readJsonBody, stripApiPrefix } from "./http/response"
import { isAgentApiRoute } from "./http/routes"
import { formatLocalDateTime, localTimeZoneLabel, localUtcOffsetLabel, toStorageIso } from "./shared/time"
import { runSelfAwake, type SelfAwakeRequest } from "./self-awake"
import type { PermissionReply, PromptPart } from "./types"

const config = loadAgentServerConfig()
const { logger, events, permissions, questions, store, sessionHydrator, coreClient, runtime } =
  createAgentApp(config)
const hubRegistry = new HubRegistryClient(config, logger)

async function ensureRuntimeSession(request: Request, sessionID: string) {
  return sessionHydrator.ensure(requireCoreToken(request), sessionID)
}

function enrichSelfAwakeContext(context: Record<string, unknown> = {}) {
  const rawCurrentTime = typeof context.current_time === "string" ? context.current_time : ""
  const parsedCurrentTime = rawCurrentTime ? new Date(rawCurrentTime) : undefined
  const currentDate =
    parsedCurrentTime && Number.isFinite(parsedCurrentTime.getTime()) ? parsedCurrentTime : new Date()

  return {
    ...context,
    current_time: toStorageIso(currentDate),
    current_time_local: formatLocalDateTime(currentDate, { seconds: true, weekday: true }),
    current_timezone: localTimeZoneLabel(),
    current_timezone_offset: localUtcOffsetLabel(currentDate),
    time_display_rule:
      "面向用户的日记正文、标题和动作说明统一使用 current_time_local 对应的本地时间；不要直接写 UTC 或 ISO 时间。",
  }
}

function buildStartupSelfAwakeContext(lastRun?: Awaited<ReturnType<typeof coreClient.listSelfAwakeRuns>>[number]) {
  const lastState = lastRun
    ? {
        last_run_at: lastRun.finished_at ?? lastRun.started_at ?? lastRun.created_at ?? "",
        next_wake_at: lastRun.next_wake_at ?? "",
        next_wake_reason: lastRun.next_wake_reason ?? "",
        source_service: lastRun.source_service,
        status: lastRun.status,
      }
    : undefined

  return enrichSelfAwakeContext({
    trigger: "agent_startup",
    source_service: "monagent",
    user_activity: "MonAgent 服务刚刚启动，测试模式下由 Agent 主动执行一次自醒。",
    ...(lastState ? { last_state: lastState } : {}),
  })
}

function hasFutureSelfAwakePlan(run: Awaited<ReturnType<typeof coreClient.listSelfAwakeRuns>>[number] | undefined) {
  if (!run || run.status !== "succeeded" || !run.next_wake_at) return false
  const nextWakeAt = new Date(run.next_wake_at)
  return Number.isFinite(nextWakeAt.getTime()) && nextWakeAt.getTime() > Date.now()
}

async function runStartupSelfAwake() {
  if (!config.selfAwake.startupWakeEnabled) {
    logger.info("Agent 启动自醒已关闭")
    return
  }

  const delayMs = Math.max(0, config.selfAwake.startupWakeDelaySeconds) * 1000
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  const { username, password } = config.authDev
  if (!username || !password) {
    logger.warn("Agent 启动自醒缺少 Core 测试账号，已跳过")
    return
  }

  const startedAtMs = Date.now()
  try {
    logger.info("Agent 启动后执行一次自醒", { username })
    const token = await coreClient.loginForToken({
      username,
      password,
      clientId: "monagent-startup-self-awake",
      clientType: "monagent",
    })
    const lastRun = (await coreClient.listSelfAwakeRuns(token, 1).catch((error) => {
      logger.warn("读取最近自醒记录失败，启动自醒继续执行", {
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }))[0]

    if (hasFutureSelfAwakePlan(lastRun)) {
      logger.info("Agent 启动自醒已跳过，已有未来自醒计划", {
        lastRunID: lastRun.id,
        nextWakeAt: lastRun.next_wake_at,
        reason: lastRun.next_wake_reason,
      })
      return
    }

    const context = buildStartupSelfAwakeContext(lastRun)
    const decision = await runSelfAwake({ context }, logger, {
      coreToken: token,
      coreClient,
      resolveCoreConfig: (coreToken) => coreClient.resolveRuntimeConfig(coreToken),
      workspaceRoot: config.workspaceRoot,
    })
    const core = await coreClient.resolveRuntimeConfig(token)
    const persisted = await coreClient.persistSelfAwakeRun(token, {
      decision,
      context,
      core,
      startedAtMs,
      finishedAtMs: Date.now(),
      sourceService: "monagent",
    })
    logger.info("Agent 启动自醒完成", {
      action: decision.action.type,
      nextWake: decision.next_wake.after_minutes,
      serverRunID: persisted?.id,
    })
  } catch (error) {
    logger.warn("Agent 启动自醒失败", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function handleApi(request: Request, url: URL) {
  if (request.method === "OPTIONS") {
    logger.debug("preflight 已处理", { path: url.pathname })
    return jsonResponse(true)
  }

  if (request.method === "GET" && url.pathname === "/events") {
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

  const promptMatch = url.pathname.match(/^\/session\/([^/]+)\/prompt$/)
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

  if (request.method === "GET" && url.pathname === "/self-awake/runs") {
    const token = requireCoreToken(request)
    const pageParam = url.searchParams.get("page")
    const pageSizeParam = url.searchParams.get("page_size")
    if (pageParam || pageSizeParam) {
      return jsonResponse(
        await coreClient.listSelfAwakeRunsPage(token, {
          page: Number(pageParam ?? 1),
          pageSize: Number(pageSizeParam ?? url.searchParams.get("limit") ?? 30),
          q: url.searchParams.get("q") ?? undefined,
        }),
      )
    }
    const limit = Number(url.searchParams.get("limit") ?? 30)
    return jsonResponse(await coreClient.listSelfAwakeRuns(token, limit))
  }

  if (request.method === "GET" && url.pathname === "/memos") {
    const token = requireCoreToken(request)
    return jsonResponse(
      await coreClient.listMemos(token, {
        kind: url.searchParams.get("kind") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        priority: url.searchParams.get("priority") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 80),
      }),
    )
  }

  if (request.method === "POST" && url.pathname === "/memos") {
    const token = requireCoreToken(request)
    const body = await readJsonBody<{
      title: string
      content?: string
      kind?: "note" | "reminder" | "todo"
      priority?: "low" | "normal" | "high"
      remind_at?: string | null
      due_at?: string | null
      repeat_rule?: string
      metadata?: Record<string, unknown>
    }>(request)
    return jsonResponse(
      await coreClient.createMemo(token, {
        ...body,
        source: "monagent_ui",
      }),
      201,
    )
  }

  const memoMatch = url.pathname.match(/^\/memos\/(\d+)$/)
  if (memoMatch && request.method === "PATCH") {
    const token = requireCoreToken(request)
    const memoID = Number(memoMatch[1])
    const body = await readJsonBody<{
      title?: string
      content?: string
      kind?: "note" | "reminder" | "todo"
      status?: "active" | "done" | "archived" | "cancelled"
      priority?: "low" | "normal" | "high"
      remind_at?: string | null
      due_at?: string | null
      repeat_rule?: string
      metadata?: Record<string, unknown>
    }>(request)
    return jsonResponse(await coreClient.updateMemo(token, memoID, body))
  }

  if (request.method === "GET" && url.pathname === "/memos/next-wake") {
    const token = requireCoreToken(request)
    return jsonResponse(await coreClient.getNextMemoWake(token, { after: url.searchParams.get("after") ?? undefined }))
  }

  if (request.method === "POST" && url.pathname === "/memos/dispatch-due") {
    const token = requireCoreToken(request)
    const body = await readJsonBody<{ before?: string; limit?: number; mark_dispatched?: boolean }>(request)
    return jsonResponse(await coreClient.dispatchDueMemos(token, body))
  }

  const memoActionMatch = url.pathname.match(/^\/memos\/(\d+)\/(complete|snooze|triggered)$/)
  if (memoActionMatch && request.method === "POST") {
    const token = requireCoreToken(request)
    const memoID = Number(memoActionMatch[1])
    const action = memoActionMatch[2]
    if (action === "complete") {
      return jsonResponse(await coreClient.completeMemo(token, memoID))
    }
    if (action === "snooze") {
      const body = await readJsonBody<{ until?: string | null; minutes?: number }>(request)
      return jsonResponse(await coreClient.snoozeMemo(token, memoID, body))
    }
    return jsonResponse(await coreClient.markMemoTriggered(token, memoID))
  }

  if (request.method === "POST" && url.pathname === "/internal/self-awake/run") {
    const body = await readJsonBody<SelfAwakeRequest>(request)
    const context = enrichSelfAwakeContext(body.context)
    const token = readAuthToken(request)
    const startedAtMs = Date.now()
    const decision = await runSelfAwake({ ...body, context }, logger, {
      coreToken: token,
      coreClient,
      resolveCoreConfig: (coreToken) => coreClient.resolveRuntimeConfig(coreToken),
      workspaceRoot: config.workspaceRoot,
    })
    let serverRunID: number | undefined
    let serverError = ""
    if (token) {
      try {
        const core = await coreClient.resolveRuntimeConfig(token)
        const persisted = await coreClient.persistSelfAwakeRun(token, {
          decision,
          context,
          core,
          startedAtMs,
          finishedAtMs: Date.now(),
        })
        if (persisted?.id) serverRunID = persisted.id
      } catch (error) {
        serverError = error instanceof Error ? error.message : String(error)
        logger.warn("Agent 自醒记录写入 Core 失败", { error: serverError })
      }
    } else {
      logger.warn("自醒请求未携带 Core token，跳过 Server 持久化")
    }
    return jsonResponse({
      ...decision,
      server_run_id: serverRunID,
      server_error: serverError,
    })
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
void runStartupSelfAwake()

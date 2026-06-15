import type { Logger } from "../shared"
import { toStorageIso } from "../shared/time"
import type { ApiMessage, ApiSession } from "../types"

export interface CoreCharacter {
  id: number
  name: string
  description?: string | null
  signature?: string | null
  ai_talk_entity_id?: number | null
}

export interface CoreAssistant {
  id: number
  name: string
  character_id?: number | null
  character?: CoreCharacter | null
  is_default?: boolean
  is_assistant_mode?: boolean
}

export interface CoreAIEntity {
  id: number
  ai_name: string
  vendor: string
  ai_model: string
  api_key: string
  api_endpoint?: string | null
  vendor_params?: Record<string, unknown>
  default_params?: Record<string, unknown>
  status?: string
  is_multimodal?: boolean
}

export interface CoreVisionConfig {
  id: number
  user: number
  vision_name: string
  vendor: string
  vision_model: string
  api_key: string
  api_endpoint: string
  status: "active" | "paused" | "error" | string
  total_requests?: number
  total_images?: number
  last_request_at?: string | null
  created_at?: string
  updated_at?: string
}

export interface CoreVisionAnalyzeImage {
  type?: "base64" | "url"
  source: string
  media_type?: string
  ref?: string
}

export interface CoreVisionAnalyzeInput {
  config_id?: number
  images: CoreVisionAnalyzeImage[]
  prompt: string
  source?: string
  related_session_id?: string
  related_message_id?: string
  tool_call_id?: string
  metadata?: Record<string, unknown>
  temperature?: number
  max_tokens?: number
  detail?: string
  extra_params?: Record<string, unknown>
}

export interface CoreVisionAnalyzeResult {
  success: boolean
  id: number
  content: string
  summary: string
  result_content?: string
  result_summary?: string
  model: string
  usage?: Record<string, unknown>
  status: string
  error?: string
  config?: {
    id: number
    name: string
    vendor: string
    model: string
    status: string
  } | null
  created_at?: string
  finished_at?: string | null
}

export interface CoreRuntimeConfig {
  assistant: CoreAssistant
  character: CoreCharacter
  aiEntity: CoreAIEntity
  visionConfig?: CoreVisionConfig | null
}

interface CoreLoginResponse {
  token?: string
  message?: string
}

export interface CoreAgentSessionMap {
  id: number
  source: string
  external_session_id: string
  title?: string
  session_payload?: unknown
  status?: string
  last_message_at?: string | null
  created_at?: string
  updated_at?: string
  messages?: CoreAgentMessageMap[]
}

export interface CoreAgentMessageMap {
  id: number
  session_map: number
  external_message_id: string
  external_parent_message_id?: string
  kind: string
  message_payload?: unknown
  moncore_message_uuid?: string | null
  moncore_step_uuid?: string | null
  tool_call_id?: string
  sync_status?: string
  created_at?: string
  updated_at?: string
}

export interface CoreSelfAwakeDecision {
  mood: string
  current_desire: string
  should_interrupt_user: boolean
  action: {
    type: string
    message: string
    payload?: Record<string, unknown>
  }
  next_wake: {
    after_minutes: number
    reason: string
  }
  diary: {
    title: string
    content: string
  }
  source?: string
  error?: string
}

export interface CoreSelfAwakeDiary {
  id: number
  run: number
  user: number
  title: string
  content: string
  summary?: string
  tags?: string[] | null
  importance?: string
  continuity_key?: string
  visible_to_user: boolean
  created_at?: string
  updated_at?: string
}

export interface CoreSelfAwakeDiaryContext {
  source: string
  last?: Record<string, unknown> | null
  recent: Array<Record<string, unknown>>
  memory: {
    summary: string
    open_threads: string[]
    avoid_repeating: string[]
    updated_at?: string | null
  }
}

export interface CoreSelfAwakeAction {
  id: number
  run: number
  user: number
  action_type: string
  message: string
  payload?: Record<string, unknown> | null
  status: string
  error: string
  created_at?: string
  updated_at?: string
}

export interface CoreSelfAwakeRun {
  id: number
  user: number
  assistant?: number | null
  character?: number | null
  source_service: string
  external_run_id: string
  status: string
  started_at?: string
  finished_at?: string | null
  context_payload?: Record<string, unknown> | null
  decision_payload?: CoreSelfAwakeDecision | Record<string, unknown> | null
  mood: string
  current_desire: string
  should_interrupt_user: boolean
  next_wake_at?: string | null
  next_wake_after_minutes?: number | null
  next_wake_reason: string
  error: string
  created_at?: string
  updated_at?: string
  diaries?: CoreSelfAwakeDiary[]
  actions?: CoreSelfAwakeAction[]
}

export interface CorePaginatedResult<T> {
  count: number
  next?: string | null
  previous?: string | null
  page_size: number
  current_page: number
  total_pages: number
  results: T[]
}

export interface CoreMemo {
  id: number
  user: number
  title: string
  content: string
  kind: "note" | "reminder" | "todo"
  status: "active" | "done" | "archived" | "cancelled"
  priority: "low" | "normal" | "high"
  remind_at?: string | null
  due_at?: string | null
  repeat_rule: string
  source: string
  related_session_id: string
  related_message_id: string
  semantic_task_id: string
  last_triggered_at?: string | null
  snoozed_until?: string | null
  completed_at?: string | null
  metadata?: Record<string, unknown>
  trigger_at?: string | null
  created_at?: string
  updated_at?: string
}

export interface CoreMemoInput {
  title: string
  content?: string
  kind?: CoreMemo["kind"]
  status?: CoreMemo["status"]
  priority?: CoreMemo["priority"]
  remind_at?: string | null
  due_at?: string | null
  repeat_rule?: string
  source?: string
  related_session_id?: string
  related_message_id?: string
  semantic_task_id?: string
  metadata?: Record<string, unknown>
}

export interface CoreMemoListInput {
  kind?: string
  status?: string
  priority?: string
  source?: string
  q?: string
  limit?: number
}

export interface CoreMemoNextWake {
  next_wake_at?: string | null
  memo?: CoreMemo | null
}

export interface CoreMemoDispatchResult {
  dispatched_count: number
  mark_dispatched: boolean
  dispatched_at: string
  memos: CoreMemo[]
  next_wake_at?: string | null
  next_memo?: CoreMemo | null
}

interface PersistSelfAwakeRunInput {
  decision: CoreSelfAwakeDecision
  context?: Record<string, unknown>
  core?: CoreRuntimeConfig
  startedAtMs?: number
  finishedAtMs?: number
  sourceService?: string
  externalRunID?: string
}

interface CoreClientOptions {
  baseUrl: string
  logger?: Logger
}

function parseJson<T>(text: string) {
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

function errorMessage(status: number, statusText: string, text: string) {
  const data = parseJson<{ error?: string; detail?: string; message?: string }>(text)
  return data?.error || data?.detail || data?.message || `${status} ${statusText}`
}

function isAuthenticationExpired(status: number, message: string) {
  return (
    status === 401 ||
    /authentication_expired|not_authenticated|invalid token|token invalid|token无效|未提供认证|认证凭据/i.test(message)
  )
}

export class CoreAuthenticationExpiredError extends Error {
  readonly path: string
  readonly status: number
  readonly detail: string

  constructor(path: string, status: number, detail: string) {
    super(`Core 认证已失效: ${path} - ${detail}`)
    this.name = "CoreAuthenticationExpired"
    this.path = path
    this.status = status
    this.detail = detail
  }
}

function normalizeBaseUrl(baseUrl: string) {
  const url = new URL(baseUrl)
  if (url.hostname === "0.0.0.0" || url.hostname === "::") {
    url.hostname = "127.0.0.1"
  }
  return url.toString().replace(/\/$/, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function unwrapResults<T>(value: T[] | { results?: T[] }): T[] {
  if (Array.isArray(value)) return value
  if (Array.isArray(value.results)) return value.results
  return []
}

function normalizePaginated<T>(
  value: T[] | Partial<CorePaginatedResult<T>>,
  fallbackPage: number,
  fallbackPageSize: number,
): CorePaginatedResult<T> {
  if (Array.isArray(value)) {
    return {
      count: value.length,
      next: null,
      previous: null,
      page_size: fallbackPageSize,
      current_page: fallbackPage,
      total_pages: 1,
      results: value,
    }
  }
  const results = Array.isArray(value.results) ? value.results : []
  const count = Number.isFinite(Number(value.count)) ? Number(value.count) : results.length
  const pageSize = Number.isFinite(Number(value.page_size)) ? Number(value.page_size) : fallbackPageSize
  return {
    count,
    next: value.next ?? null,
    previous: value.previous ?? null,
    page_size: pageSize,
    current_page: Number.isFinite(Number(value.current_page)) ? Number(value.current_page) : fallbackPage,
    total_pages: Number.isFinite(Number(value.total_pages))
      ? Number(value.total_pages)
      : Math.max(1, Math.ceil(count / Math.max(1, pageSize))),
    results,
  }
}

function toMillis(value: unknown, fallback = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function runIDFromMillis(prefix: string, millis: number) {
  const stamp = toStorageIso(millis).replace(/[-:.TZ]/g, "")
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${stamp}-${suffix}`
}

function safeMinutes(value: unknown, fallback = 720) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function actionStatus(decision: CoreSelfAwakeDecision) {
  if (decision.source === "fallback") return "failed"
  return decision.action.type === "observe_only" || decision.action.type === "write_diary" ? "succeeded" : "pending"
}

function isApiSessionPayload(value: unknown): value is ApiSession {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") return false
  const time = value.time
  return isRecord(time) && typeof time.created === "number" && typeof time.updated === "number"
}

function isApiMessagePayload(value: unknown): value is ApiMessage {
  if (!isRecord(value) || !isRecord(value.info) || !Array.isArray(value.parts)) return false
  const info = value.info
  return typeof info.id === "string" && (info.role === "user" || info.role === "assistant")
}

function sessionFromMap(map: CoreAgentSessionMap): ApiSession {
  const payload = isApiSessionPayload(map.session_payload) ? map.session_payload : undefined
  const created = payload?.time.created ?? toMillis(map.created_at)
  const updated = Math.max(
    payload?.time.updated ?? 0,
    toMillis(map.last_message_at, 0),
    toMillis(map.updated_at, created),
    created,
  )

  return {
    id: map.external_session_id,
    title: map.title || payload?.title || "新会话",
    time: {
      created,
      updated,
    },
  }
}

function messageFromMap(map: CoreAgentMessageMap): ApiMessage {
  if (isApiMessagePayload(map.message_payload)) return map.message_payload
  const created = toMillis(map.created_at)
  return {
    info: {
      id: map.external_message_id || `core_msg_${map.id}`,
      role: map.kind === "user" ? "user" : "assistant",
      time: {
        created,
        completed: toMillis(map.updated_at, created),
      },
    },
    parts: [],
  }
}

export function createCoreBaseUrl(input: { baseUrl?: string | null; host?: string | null; port: number }) {
  const raw = input.baseUrl?.trim()
  if (raw) return normalizeBaseUrl(raw)

  const host = !input.host || input.host === "0.0.0.0" || input.host === "::" ? "127.0.0.1" : input.host
  return normalizeBaseUrl(`http://${host}:${input.port}`)
}

export class CoreClient {
  readonly baseUrl: string
  private readonly logger?: Logger

  constructor(options: CoreClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.logger = options.logger
  }

  async loginForToken(input: { username: string; password: string; clientId: string; clientType: string }) {
    const response = await fetch(`${this.baseUrl}/api/api-token-auth/`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: input.username,
        password: input.password,
        client_id: input.clientId,
        client_type: input.clientType,
      }),
    })
    const text = await response.text().catch(() => "")
    if (!response.ok) {
      throw new Error(`Core 登录失败: ${errorMessage(response.status, response.statusText, text)}`)
    }
    const data = parseJson<CoreLoginResponse>(text)
    if (!data?.token) {
      throw new Error("Core 登录成功但未返回 token")
    }
    return data.token
  }

  async resolveRuntimeConfig(token?: string | null): Promise<CoreRuntimeConfig | undefined> {
    if (!token) return undefined

    const assistant = await this.request<CoreAssistant>("/api/assistants/default/", token)
    const character = assistant.character
    if (!character) {
      throw new Error("默认助手没有绑定角色，请先在 Core 助手管理中绑定角色。")
    }

    const aiEntityID = character.ai_talk_entity_id
    if (!aiEntityID) {
      throw new Error(`角色「${character.name}」没有绑定对话 AI，请先在角色配置中设置 AI 实体。`)
    }

    const aiEntity = await this.request<CoreAIEntity>(
      `/api/ai/entities/${encodeURIComponent(String(aiEntityID))}/`,
      token,
    )
    if (!aiEntity.api_key) {
      throw new Error(`AI 实体「${aiEntity.ai_name}」没有配置 API Key。`)
    }
    if (aiEntity.status && aiEntity.status !== "active") {
      this.logger?.warn("Core AI 实体不是 active 状态", {
        aiEntityID: aiEntity.id,
        status: aiEntity.status,
      })
    }

    this.logger?.info("Core 运行配置已解析", {
      assistantID: assistant.id,
      assistant: assistant.name,
      characterID: character.id,
      character: character.name,
      aiEntityID: aiEntity.id,
      aiEntity: aiEntity.ai_name,
      vendor: aiEntity.vendor,
      model: aiEntity.ai_model,
    })

    const visionConfigs = await this.listVisionConfigs(token).catch((error) => {
      this.logger?.warn("读取 Core Vision 配置失败，视觉工具将只使用当前对话模型", {
        error: error instanceof Error ? error.message : String(error),
      })
      return [] as CoreVisionConfig[]
    })
    const visionConfig = visionConfigs.find((config) => config.status === "active") ?? visionConfigs[0] ?? null

    return { assistant, character, aiEntity, visionConfig }
  }

  async syncAgentSession(
    token: string | null | undefined,
    session: ApiSession,
    core?: CoreRuntimeConfig,
  ): Promise<CoreAgentSessionMap | undefined> {
    if (!token) return undefined

    const payload = {
      source: "monagent",
      external_session_id: session.id,
      assistant: core?.assistant.id,
      character: core?.character.id,
      title: session.title,
      session_payload: session,
      status: "active",
      last_message_at: toStorageIso(session.time.updated),
    }

    const result = await this.request<CoreAgentSessionMap>("/api/agent/sessions/", token, {
      method: "POST",
      body: JSON.stringify(payload),
    })
    this.logger?.debug("Agent 会话已同步到 Core", {
      sessionID: session.id,
      coreSessionMapID: result.id,
      assistantID: core?.assistant.id,
      characterID: core?.character.id,
    })
    return result
  }

  async listAgentSessionMaps(token: string, limit = 50): Promise<CoreAgentSessionMap[]> {
    const raw = await this.request<CoreAgentSessionMap[] | { results?: CoreAgentSessionMap[] }>(
      `/api/agent/sessions/?limit=${encodeURIComponent(String(limit))}`,
      token,
    )
    return unwrapResults(raw)
  }

  async listAgentSessions(token: string, limit = 50): Promise<ApiSession[]> {
    return (await this.listAgentSessionMaps(token, limit)).map(sessionFromMap)
  }

  async getAgentSession(token: string, externalSessionID: string): Promise<{ info: ApiSession; messages: ApiMessage[] }> {
    const raw = await this.request<CoreAgentSessionMap[] | { results?: CoreAgentSessionMap[] }>(
      `/api/agent/sessions/?external_session_id=${encodeURIComponent(externalSessionID)}&limit=1`,
      token,
    )
    const sessionMap = unwrapResults(raw)[0]
    if (!sessionMap) {
      throw new Error(`Core 会话不存在: ${externalSessionID}`)
    }

    const info = sessionFromMap(sessionMap)
    let messageMaps = sessionMap.messages
    if (!messageMaps) {
      const rawMessages = await this.request<CoreAgentMessageMap[] | { results?: CoreAgentMessageMap[] }>(
        `/api/agent/sessions/${encodeURIComponent(String(sessionMap.id))}/messages/`,
        token,
      )
      messageMaps = unwrapResults(rawMessages)
    }

    const messages = messageMaps
      .map(messageFromMap)
      .sort((left, right) => left.info.time.created - right.info.time.created)
    return { info, messages }
  }

  async syncAgentMessage(
    token: string | null | undefined,
    session: ApiSession,
    message: ApiMessage,
    core?: CoreRuntimeConfig,
  ) {
    const sessionMap = await this.syncAgentSession(token, session, core)
    if (!token || !sessionMap) return undefined

    const firstToolPart = message.parts.find((part) => part.type === "tool")
    const payload = {
      external_message_id: message.info.id,
      external_parent_message_id: "",
      kind: message.info.role === "user" ? "user" : "assistant",
      message_payload: message,
      tool_call_id: firstToolPart?.id ?? "",
      sync_status: "synced",
    }

    const result = await this.request(`/api/agent/sessions/${encodeURIComponent(String(sessionMap.id))}/messages/`, token, {
      method: "POST",
      body: JSON.stringify(payload),
    })
    this.logger?.debug("Agent 消息已同步到 Core", {
      sessionID: session.id,
      messageID: message.info.id,
      coreSessionMapID: sessionMap.id,
      kind: payload.kind,
    })
    return result
  }

  async persistSelfAwakeRun(token: string | null | undefined, input: PersistSelfAwakeRunInput) {
    if (!token) return undefined

    const finishedAtMs = input.finishedAtMs ?? Date.now()
    const startedAtMs = input.startedAtMs ?? finishedAtMs
    const afterMinutes = safeMinutes(input.decision.next_wake?.after_minutes)
    const nextWakeAt = toStorageIso(finishedAtMs + afterMinutes * 60 * 1000)
    const failed = input.decision.source === "fallback"
    const payload = {
      source_service: input.sourceService ?? "monagent",
      external_run_id: input.externalRunID ?? runIDFromMillis("monagent", startedAtMs),
      assistant: input.core?.assistant.id,
      character: input.core?.character.id,
      status: failed ? "failed" : "succeeded",
      started_at: toStorageIso(startedAtMs),
      finished_at: toStorageIso(finishedAtMs),
      context: input.context ?? null,
      decision: input.decision,
      mood: input.decision.mood,
      current_desire: input.decision.current_desire,
      should_interrupt_user: input.decision.should_interrupt_user,
      next_wake_at: nextWakeAt,
      next_wake_after_minutes: afterMinutes,
      next_wake_reason: input.decision.next_wake?.reason ?? "",
      error: input.decision.error ?? "",
      diary: {
        title: input.decision.diary?.title ?? "",
        content: input.decision.diary?.content ?? "",
        visible_to_user: true,
      },
      action: {
        action_type: input.decision.action?.type ?? "write_diary",
        message: input.decision.action?.message ?? "",
        payload: input.decision.action?.payload ?? {},
        status: actionStatus(input.decision),
        error: failed ? input.decision.error ?? "自醒 Agent 使用 fallback 决策。" : "",
      },
    }

    const result = await this.request<{ id?: number }>("/api/agent/self-awake/runs/", token, {
      method: "POST",
      body: JSON.stringify(payload),
    })
    this.logger?.info("Agent 自醒记录已写入 Core", {
      runID: result.id,
      source: payload.source_service,
      status: payload.status,
      assistantID: input.core?.assistant.id,
      characterID: input.core?.character.id,
    })
    return result
  }

  async listSelfAwakeRuns(token: string, limit = 30): Promise<CoreSelfAwakeRun[]> {
    return (await this.listSelfAwakeRunsPage(token, { page: 1, pageSize: limit })).results
  }

  async listSelfAwakeRunsPage(
    token: string,
    input: { page?: number; pageSize?: number; q?: string } = {},
  ): Promise<CorePaginatedResult<CoreSelfAwakeRun>> {
    const page = Math.max(1, Math.round(input.page ?? 1))
    const pageSize = Math.min(Math.max(Math.round(input.pageSize ?? 30), 1), 100)
    const search = new URLSearchParams()
    search.set("page", String(page))
    search.set("page_size", String(pageSize))
    if (input.q?.trim()) search.set("q", input.q.trim())
    const raw = await this.request<CoreSelfAwakeRun[] | Partial<CorePaginatedResult<CoreSelfAwakeRun>>>(
      `/api/agent/self-awake/runs/?${search.toString()}`,
      token,
    )
    return normalizePaginated(raw, page, pageSize)
  }

  async getSelfAwakeDiaryContext(token: string, limit = 5): Promise<CoreSelfAwakeDiaryContext> {
    return this.request<CoreSelfAwakeDiaryContext>(
      `/api/agent/self-awake/diaries/context/?limit=${encodeURIComponent(String(limit))}`,
      token,
    )
  }

  async createMemo(token: string, input: CoreMemoInput): Promise<CoreMemo> {
    return this.request<CoreMemo>("/api/memos/", token, {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  async updateMemo(token: string, id: number, input: Partial<CoreMemoInput>): Promise<CoreMemo> {
    return this.request<CoreMemo>(`/api/memos/${encodeURIComponent(String(id))}/`, token, {
      method: "PATCH",
      body: JSON.stringify(input),
    })
  }

  async listMemos(token: string, input: CoreMemoListInput = {}): Promise<CoreMemo[]> {
    const params = new URLSearchParams()
    for (const key of ["kind", "status", "priority", "source", "q"] as const) {
      const value = input[key]
      if (typeof value === "string" && value.trim()) params.set(key, value.trim())
    }
    const path = `/api/memos/${params.toString() ? `?${params.toString()}` : ""}`
    const raw = await this.request<CoreMemo[] | { results?: CoreMemo[] }>(path, token)
    const memos = unwrapResults(raw)
    const limit = Number(input.limit)
    if (Number.isFinite(limit) && limit > 0) return memos.slice(0, Math.round(limit))
    return memos
  }

  async listDueMemos(token: string, input: { before?: string; limit?: number } = {}): Promise<CoreMemo[]> {
    const params = new URLSearchParams()
    if (input.before?.trim()) params.set("before", input.before.trim())
    const path = `/api/memos/due/${params.toString() ? `?${params.toString()}` : ""}`
    const raw = await this.request<CoreMemo[] | { results?: CoreMemo[] }>(path, token)
    const memos = unwrapResults(raw)
    const limit = Number(input.limit)
    if (Number.isFinite(limit) && limit > 0) return memos.slice(0, Math.round(limit))
    return memos
  }

  async dispatchDueMemos(
    token: string,
    input: { before?: string; limit?: number; mark_dispatched?: boolean } = {},
  ): Promise<CoreMemoDispatchResult> {
    return this.request<CoreMemoDispatchResult>("/api/memos/dispatch-due/", token, {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  async getNextMemoWake(token: string, input: { after?: string } = {}): Promise<CoreMemoNextWake> {
    const params = new URLSearchParams()
    if (input.after?.trim()) params.set("after", input.after.trim())
    const path = `/api/memos/next-wake/${params.toString() ? `?${params.toString()}` : ""}`
    return this.request<CoreMemoNextWake>(path, token)
  }

  async completeMemo(token: string, id: number): Promise<CoreMemo> {
    return this.request<CoreMemo>(`/api/memos/${encodeURIComponent(String(id))}/complete/`, token, {
      method: "POST",
      body: JSON.stringify({}),
    })
  }

  async snoozeMemo(token: string, id: number, input: { until?: string | null; minutes?: number }): Promise<CoreMemo> {
    return this.request<CoreMemo>(`/api/memos/${encodeURIComponent(String(id))}/snooze/`, token, {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  async markMemoTriggered(token: string, id: number): Promise<CoreMemo> {
    return this.request<CoreMemo>(`/api/memos/${encodeURIComponent(String(id))}/mark-triggered/`, token, {
      method: "POST",
      body: JSON.stringify({}),
    })
  }

  async listVisionConfigs(token: string): Promise<CoreVisionConfig[]> {
    const raw = await this.request<CoreVisionConfig[] | { results?: CoreVisionConfig[] }>(
      "/api/vision/configs/",
      token,
    )
    return unwrapResults(raw)
  }

  async analyzeVision(token: string, input: CoreVisionAnalyzeInput): Promise<CoreVisionAnalyzeResult> {
    return this.request<CoreVisionAnalyzeResult>("/api/vision/analyze/", token, {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  private async request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        authorization: `Token ${token}`,
        ...init?.headers,
      },
    })
    const text = await response.text().catch(() => "")
    if (!response.ok) {
      const message = errorMessage(response.status, response.statusText, text)
      if (isAuthenticationExpired(response.status, message)) {
        throw new CoreAuthenticationExpiredError(path, response.status, message)
      }
      throw new Error(`Core 请求失败: ${path} - ${message}`)
    }
    const data = parseJson<T>(text)
    if (data === undefined) {
      throw new Error(`Core 响应不是有效 JSON: ${path}`)
    }
    return data
  }
}

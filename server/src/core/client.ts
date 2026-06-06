import type { Logger } from "../shared"
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
}

export interface CoreRuntimeConfig {
  assistant: CoreAssistant
  character: CoreCharacter
  aiEntity: CoreAIEntity
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

function toMillis(value: unknown, fallback = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
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

    return { assistant, character, aiEntity }
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
      last_message_at: new Date(session.time.updated).toISOString(),
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

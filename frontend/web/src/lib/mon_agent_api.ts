import type { MessageData, PendingPermission, PendingQuestion, PromptAttachment, Session, ToolCall } from "../types"
import { getStoredToken } from "./auth"
import { formatLocalTime } from "./time"

const env = (
  import.meta as unknown as {
    env?: {
      DEV?: boolean
      VITE_MON_AGENT_BASE_URL?: string
    }
  }
).env
const baseUrl = env?.DEV
  ? "/api"
  : (env?.VITE_MON_AGENT_BASE_URL ?? "http://localhost:40092")

export type ApiSession = {
  id: string
  title: string
  time: {
    updated: number
    created: number
  }
}

export type ToolStatus = {
  search: {
    status: "online" | "offline" | "starting"
    provider?: "duckduckgo"
    mode?: "embedded" | "disabled"
    label?: string
    endpoint?: string
    latencyMs?: number
    message?: string
  }
  tools: {
    search: string
    fetch: string
  }
}

export type ApiSelfAwakeDiary = {
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

export type ApiSelfAwakeAction = {
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

export type ApiSelfAwakeRun = {
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
  decision_payload?: Record<string, unknown> | null
  mood: string
  current_desire: string
  should_interrupt_user: boolean
  next_wake_at?: string | null
  next_wake_after_minutes?: number | null
  next_wake_reason: string
  error: string
  created_at?: string
  updated_at?: string
  diaries?: ApiSelfAwakeDiary[]
  actions?: ApiSelfAwakeAction[]
}

export type ApiPaginatedResult<T> = {
  count: number
  next?: string | null
  previous?: string | null
  page_size: number
  current_page: number
  total_pages: number
  results: T[]
}

export type ApiMemoKind = "note" | "reminder" | "todo"
export type ApiMemoStatus = "active" | "done" | "archived" | "cancelled"
export type ApiMemoPriority = "low" | "normal" | "high"

export type ApiMemo = {
  id: number
  user: number
  title: string
  content: string
  kind: ApiMemoKind
  status: ApiMemoStatus
  priority: ApiMemoPriority
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

export type ApiMemoInput = {
  title: string
  content?: string
  kind?: ApiMemoKind
  status?: ApiMemoStatus
  priority?: ApiMemoPriority
  remind_at?: string | null
  due_at?: string | null
  repeat_rule?: string
  metadata?: Record<string, unknown>
}

export type ApiMessageInfo =
  | {
      id: string
      role: "user"
      time: {
        created: number
      }
    }
  | {
      id: string
      role: "assistant"
      time: {
        created: number
        completed?: number
      }
      agent?: string
      modelID?: string
      providerID?: string
      error?: {
        name?: string
        message?: string
        data?: {
          message?: string
          code?: string
          path?: string
          status?: number
        }
      }
    }

export type ApiTextPart = {
  id: string
  messageID: string
  sessionID: string
  type: "text"
  text: string
  time?: {
    start?: number
    end?: number
  }
}

export type ApiReasoningPart = {
  id: string
  messageID: string
  sessionID: string
  type: "reasoning"
  text: string
  source?: "runtime" | "model"
  title?: string
  time?: {
    start?: number
    end?: number
  }
}

export type ApiFilePart = {
  id: string
  messageID: string
  sessionID: string
  type: "file"
  mime: string
  url: string
  filename?: string
}

export type ApiSnapshotPart = {
  id: string
  messageID: string
  sessionID: string
  type: "snapshot"
  snapshot: string
}

export type ApiPatchPart = {
  id: string
  messageID: string
  sessionID: string
  type: "patch"
  hash: string
  files: string[]
}

export type ApiAgentPart = {
  id: string
  messageID: string
  sessionID: string
  type: "agent"
  name: string
  source?: {
    value: string
    start: number
    end: number
  }
}

export type ApiCompactionPart = {
  id: string
  messageID: string
  sessionID: string
  type: "compaction"
  auto: boolean
  overflow?: boolean
  tail_start_id?: string
}

export type ApiSubtaskPart = {
  id: string
  messageID: string
  sessionID: string
  type: "subtask"
  prompt: string
  description: string
  agent: string
  model?: {
    providerID: string
    modelID: string
  }
  command?: string
}

export type ApiRetryPart = {
  id: string
  messageID: string
  sessionID: string
  type: "retry"
  attempt: number
  error: {
    message?: string
    statusCode?: number
    isRetryable?: boolean
  }
  time: {
    created: number
  }
}

export type ApiStepStartPart = {
  id: string
  messageID: string
  sessionID: string
  type: "step-start"
  snapshot?: string
}

export type ApiStepFinishPart = {
  id: string
  messageID: string
  sessionID: string
  type: "step-finish"
  reason: string
  snapshot?: string
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
}

export type ApiToolState =
  | { status: "pending" | "running"; input?: unknown; time?: { start?: number; end?: number } }
  | { status: "completed"; input?: unknown; output: string; time?: { start?: number; end?: number } }
  | { status: "error"; input?: unknown; error: string; time?: { start?: number; end?: number } }

export type ApiToolPart = {
  id: string
  messageID: string
  sessionID: string
  type: "tool"
  tool: string
  state: ApiToolState
}

export type ApiUnknownPart = {
  id: string
  messageID: string
  sessionID: string
  type: string
  [key: string]: unknown
}

export type ApiPart =
  | ApiTextPart
  | ApiReasoningPart
  | ApiFilePart
  | ApiSnapshotPart
  | ApiPatchPart
  | ApiAgentPart
  | ApiCompactionPart
  | ApiSubtaskPart
  | ApiRetryPart
  | ApiStepStartPart
  | ApiStepFinishPart
  | ApiToolPart
  | ApiUnknownPart

export type ApiMessage = {
  info: ApiMessageInfo
  parts: ApiPart[]
}

export type SessionCreatedEvent = {
  type: "session.created" | "session.updated"
  properties: {
    sessionID: string
    info: ApiSession
  }
}

export type SessionStatusEvent = {
  type: "session.status"
  properties: {
    sessionID: string
    status: {
      type?: "idle" | "busy" | "retry" | string
      [key: string]: unknown
    }
  }
}

export type SessionErrorEvent = {
  type: "session.error"
  properties: {
    sessionID?: string
    error?: {
      name?: string
      message?: string
      data?: {
        message?: string
        code?: string
        path?: string
        status?: number
      }
    }
  }
}

export type PermissionAskedEvent = {
  type: "permission.asked"
  properties: PendingPermission
}

export type PermissionRepliedEvent = {
  type: "permission.replied"
  properties: {
    sessionID: string
    requestID: string
    reply: "once" | "always" | "reject"
  }
}

export type QuestionAskedEvent = {
  type: "question.asked"
  properties: PendingQuestion
}

export type QuestionRepliedEvent = {
  type: "question.replied"
  properties: {
    sessionID: string
    requestID: string
    answers: string[][]
  }
}

export type QuestionRejectedEvent = {
  type: "question.rejected"
  properties: {
    sessionID: string
    requestID: string
  }
}

export type MessageUpdatedEvent = {
  type: "message.updated"
  properties: {
    sessionID: string
    info: ApiMessageInfo
  }
}

export type MessagePartUpdatedEvent = {
  type: "message.part.updated"
  properties: {
    sessionID: string
    part: ApiPart
    time?: number
  }
}

export type MessagePartDeltaEvent = {
  type: "message.part.delta"
  properties: {
    sessionID: string
    messageID: string
    partID: string
    field: string
    delta: string
    baseLength?: number
    targetText?: string
    partType?: "text" | "reasoning"
    source?: "runtime" | "model"
    title?: string
    time?: {
      start?: number
      end?: number
    }
  }
}

export type MessagePartRemovedEvent = {
  type: "message.part.removed"
  properties: {
    sessionID: string
    messageID: string
    partID: string
  }
}

export type ApiEvent =
  | SessionCreatedEvent
  | SessionStatusEvent
  | SessionErrorEvent
  | PermissionAskedEvent
  | PermissionRepliedEvent
  | QuestionAskedEvent
  | QuestionRepliedEvent
  | QuestionRejectedEvent
  | MessageUpdatedEvent
  | MessagePartUpdatedEvent
  | MessagePartDeltaEvent
  | MessagePartRemovedEvent
  | {
      type: string
      properties?: {
        sessionID?: string
        [key: string]: unknown
      }
    }

type GlobalEventFrame = {
  directory?: string
  project?: string
  workspace?: string
  payload: ApiEvent
}

type SubscribeHandlers = {
  onEvent: (event: ApiEvent) => void
  onOpen?: () => void
  onError?: (error: string) => void
}

export function isApiTextPart(part: ApiPart): part is ApiTextPart {
  return part.type === "text" && typeof (part as { text?: unknown }).text === "string"
}

export function isApiReasoningPart(part: ApiPart): part is ApiReasoningPart {
  return part.type === "reasoning" && typeof (part as { text?: unknown }).text === "string"
}

export function isApiFilePart(part: ApiPart): part is ApiFilePart {
  return (
    part.type === "file" &&
    typeof (part as { mime?: unknown; url?: unknown }).mime === "string" &&
    typeof (part as { url?: unknown }).url === "string"
  )
}

export function isApiToolPart(part: ApiPart): part is ApiToolPart {
  return (
    part.type === "tool" &&
    typeof (part as { tool?: unknown }).tool === "string" &&
    typeof (part as { state?: unknown }).state === "object"
  )
}

export function isApiSnapshotPart(part: ApiPart): part is ApiSnapshotPart {
  return part.type === "snapshot" && typeof (part as { snapshot?: unknown }).snapshot === "string"
}

export function isApiPatchPart(part: ApiPart): part is ApiPatchPart {
  return (
    part.type === "patch" &&
    typeof (part as { hash?: unknown }).hash === "string" &&
    Array.isArray((part as { files?: unknown }).files)
  )
}

export function isApiAgentPart(part: ApiPart): part is ApiAgentPart {
  return part.type === "agent" && typeof (part as { name?: unknown }).name === "string"
}

export function isApiCompactionPart(part: ApiPart): part is ApiCompactionPart {
  return part.type === "compaction" && typeof (part as { auto?: unknown }).auto === "boolean"
}

export function isApiSubtaskPart(part: ApiPart): part is ApiSubtaskPart {
  return (
    part.type === "subtask" &&
    typeof (part as { prompt?: unknown }).prompt === "string" &&
    typeof (part as { description?: unknown }).description === "string" &&
    typeof (part as { agent?: unknown }).agent === "string"
  )
}

export function isApiRetryPart(part: ApiPart): part is ApiRetryPart {
  return (
    part.type === "retry" &&
    typeof (part as { attempt?: unknown }).attempt === "number" &&
    typeof (part as { error?: unknown }).error === "object"
  )
}

export function isApiStepStartPart(part: ApiPart): part is ApiStepStartPart {
  return part.type === "step-start"
}

export function isApiStepFinishPart(part: ApiPart): part is ApiStepFinishPart {
  return (
    part.type === "step-finish" &&
    typeof (part as { reason?: unknown }).reason === "string" &&
    typeof (part as { cost?: unknown }).cost === "number"
  )
}

export function isCoreAuthExpiredEvent(event: ApiEvent) {
  if (event.type !== "session.error") return false
  const properties = event.properties as SessionErrorEvent["properties"] | undefined
  const error = properties?.error
  const text = `${error?.name ?? ""} ${error?.message ?? ""} ${error?.data?.message ?? ""} ${error?.data?.code ?? ""}`
  return (
    error?.name === "CoreAuthenticationExpired" ||
    error?.data?.code === "core_authentication_expired" ||
    /authentication_expired|not_authenticated/i.test(text)
  )
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken()
  if (!token) {
    throw new Error("not_authenticated: Core token missing")
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(token ? { Authorization: `Token ${token}` } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${text}` : ""}`)
  }

  return response.json() as Promise<T>
}

function timeLabel(value?: number) {
  return formatLocalTime(value)
}

function stringify(value: unknown) {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return String(value)
  }
}

export function resolveMonAgentUrl(url: string) {
  if (!url) return url
  if (/^(data:|blob:|https?:\/\/)/i.test(url)) return url
  if (url.startsWith("file://")) {
    if (!window.monAgentDesktop?.convertFileSrc) return url

    try {
      const fileUrl = new URL(url)
      const pathname = decodeURIComponent(fileUrl.pathname)
      const filePath = pathname.replace(/^\/([A-Za-z]:\/)/, "$1").replace(/\//g, "\\")
      return window.monAgentDesktop.convertFileSrc(filePath)
    } catch {
      return url
    }
  }
  if (url.startsWith("/api/")) return url
  if (url.startsWith("/")) return `${baseUrl}${url}`
  return url
}

function mapTool(part: ApiToolPart): ToolCall {
  const state = part.state
  const status = state.status === "completed" ? "success" : state.status === "error" ? "error" : "running"
  const time = state.time
  const start = time?.start
  const end = time?.end

  return {
    id: part.id,
    name: part.tool,
    status,
    input: stringify("input" in state ? state.input : {}),
    output: state.status === "completed" ? state.output : undefined,
    error: state.status === "error" ? state.error : undefined,
    duration: start && end ? end - start : undefined,
  }
}

export function mapSession(info: ApiSession, messages: MessageData[] = []): Session {
  return {
    id: info.id,
    title: info.title || "新会话",
    date: timeLabel(info.time.updated),
    messages,
  }
}

export function mapMessage(input: ApiMessage): MessageData {
  const text = input.parts
    .filter(
      (part): part is ApiTextPart => isApiTextPart(part) && !(part as ApiTextPart & { synthetic?: boolean }).synthetic,
    )
    .map((part) => part.text)
    .join("\n")
    .trim()
  const reasoningParts = input.parts.filter(isApiReasoningPart)
  const runtimeTrace = reasoningParts
    .filter((part) => part.source === "runtime" || part.id.endsWith("_runtime_thinking"))
    .map((part) => part.text)
    .join("\n")
    .trim()
  const reasoning = reasoningParts
    .filter((part) => part.source !== "runtime" && !part.id.endsWith("_runtime_thinking"))
    .map((part) => part.text)
    .join("\n")
    .trim()
  const images = input.parts
    .filter((part): part is ApiFilePart => isApiFilePart(part) && part.mime.startsWith("image/"))
    .map((part) => part.url)
  const toolCalls = input.parts.filter(isApiToolPart).map(mapTool)

  return {
    id: input.info.id,
    role: input.info.role,
    content: text,
    timestamp: timeLabel(input.info.time.created),
    runtimeTrace: runtimeTrace || undefined,
    thinking: reasoning || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    images: images.length ? images : undefined,
  }
}

export async function listSessionsRaw() {
  return request<ApiSession[]>("/session?limit=50")
}

export async function listSessions() {
  const sessions = await listSessionsRaw()
  return sessions.map((session) => mapSession(session))
}

export async function createSessionRaw() {
  return request<ApiSession>("/session", {
    method: "POST",
    body: JSON.stringify({ title: "" }),
  })
}

export async function createSession() {
  const session = await createSessionRaw()
  return mapSession(session)
}

export async function listMessagesRaw(sessionID: string) {
  return request<ApiMessage[]>(`/session/${encodeURIComponent(sessionID)}/message?limit=100`)
}

export async function listMessages(sessionID: string) {
  const messages = await listMessagesRaw(sessionID)
  return messages.map(mapMessage)
}

function normalizeAttachment(attachment: PromptAttachment | string, index: number): PromptAttachment {
  if (typeof attachment === "string") {
    return {
      url: attachment,
      filename: `image-${index + 1}.png`,
      mime: "image/png",
    }
  }
  return {
    url: attachment.url,
    filename: attachment.filename || `attachment-${index + 1}`,
    mime: attachment.mime || "application/octet-stream",
    size: attachment.size,
  }
}

function createPromptParts(content: string, attachments: Array<PromptAttachment | string>) {
  return [
    ...attachments.map((attachment, index) => {
      const file = normalizeAttachment(attachment, index)
      return {
        type: "file" as const,
        url: file.url,
        filename: file.filename,
        mime: file.mime,
        size: file.size,
      }
    }),
    ...(content ? [{ type: "text" as const, text: content }] : []),
  ]
}

export async function sendPrompt(sessionID: string, content: string, attachments: Array<PromptAttachment | string>) {
  await request(`/session/${encodeURIComponent(sessionID)}/prompt`, {
    method: "POST",
    body: JSON.stringify({
      parts: createPromptParts(content, attachments),
    }),
  })
}

export async function sendPromptAsync(sessionID: string, content: string, attachments: Array<PromptAttachment | string>) {
  await request(`/session/${encodeURIComponent(sessionID)}/prompt`, {
    method: "POST",
    body: JSON.stringify({
      parts: createPromptParts(content, attachments),
    }),
  })
}

export async function listPermissionsRaw() {
  return request<PendingPermission[]>("/permission")
}

export async function replyPermission(requestID: string, reply: "once" | "always" | "reject", message?: string) {
  await request<boolean>(`/permission/${encodeURIComponent(requestID)}/reply`, {
    method: "POST",
    body: JSON.stringify({
      reply,
      ...(message ? { message } : {}),
    }),
  })
}

export async function listQuestionsRaw() {
  return request<PendingQuestion[]>("/question")
}

export async function replyQuestion(requestID: string, answers: string[][]) {
  await request<boolean>(`/question/${encodeURIComponent(requestID)}/reply`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  })
}

export async function rejectQuestion(requestID: string) {
  await request<boolean>(`/question/${encodeURIComponent(requestID)}/reject`, {
    method: "POST",
  })
}

export async function getToolStatus() {
  return request<ToolStatus>("/tools/status")
}

export async function listSelfAwakeRuns(limit = 30) {
  const raw = await request<ApiSelfAwakeRun[] | ApiPaginatedResult<ApiSelfAwakeRun>>(
    `/self-awake/runs?limit=${encodeURIComponent(String(limit))}`,
  )
  return Array.isArray(raw) ? raw : raw.results
}

export async function listSelfAwakeRunsPage({
  page = 1,
  pageSize = 20,
  q,
}: {
  page?: number
  pageSize?: number
  q?: string
} = {}) {
  const search = new URLSearchParams()
  search.set("page", String(page))
  search.set("page_size", String(pageSize))
  if (q?.trim()) search.set("q", q.trim())
  return request<ApiPaginatedResult<ApiSelfAwakeRun>>(`/self-awake/runs?${search.toString()}`)
}

export async function listMemos(params: {
  kind?: string
  status?: string
  priority?: string
  q?: string
  limit?: number
} = {}) {
  const search = new URLSearchParams()
  if (params.kind) search.set("kind", params.kind)
  if (params.status) search.set("status", params.status)
  if (params.priority) search.set("priority", params.priority)
  if (params.q) search.set("q", params.q)
  search.set("limit", String(params.limit ?? 80))
  return request<ApiMemo[]>(`/memos?${search.toString()}`)
}

export async function createMemo(input: ApiMemoInput) {
  return request<ApiMemo>("/memos", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateMemo(id: number, input: Partial<ApiMemoInput>) {
  return request<ApiMemo>(`/memos/${encodeURIComponent(String(id))}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export async function completeMemo(id: number) {
  return request<ApiMemo>(`/memos/${encodeURIComponent(String(id))}/complete`, {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export async function snoozeMemo(id: number, input: { until?: string | null; minutes?: number }) {
  return request<ApiMemo>(`/memos/${encodeURIComponent(String(id))}/snooze`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function subscribeEvents(handlers: SubscribeHandlers | ((event: ApiEvent) => void)) {
  if (!getStoredToken()) {
    return () => {}
  }
  const normalized: SubscribeHandlers = typeof handlers === "function" ? { onEvent: handlers } : handlers
  const source = new EventSource(`${baseUrl}/events`)

  source.onopen = () => {
    normalized.onOpen?.()
  }

  source.onmessage = (message) => {
    try {
      const frame = JSON.parse(message.data) as GlobalEventFrame | ApiEvent
      normalized.onEvent("payload" in frame ? frame.payload : frame)
    } catch {
      // Ignore malformed SSE frames.
    }
  }

  source.onerror = () => {
    normalized.onError?.("Event stream disconnected")
  }

  return () => source.close()
}

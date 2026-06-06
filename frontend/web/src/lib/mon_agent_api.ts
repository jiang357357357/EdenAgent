import type { MessageData, PendingPermission, PendingQuestion, PromptAttachment, Session, ToolCall } from "../types"
import { getStoredToken } from "./auth"

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
  if (!value) return ""
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
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
    if (!("__TAURI_INTERNALS__" in window)) return url

    try {
      const fileUrl = new URL(url)
      const pathname = decodeURIComponent(fileUrl.pathname)
      const filePath = pathname.replace(/^\/([A-Za-z]:\/)/, "$1").replace(/\//g, "\\")
      return (
        (
          window as unknown as {
            __TAURI_INTERNALS__?: {
              convertFileSrc?: (filePath: string, protocol?: string) => string
            }
          }
        ).__TAURI_INTERNALS__?.convertFileSrc?.(filePath) ?? url
      )
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
  await request(`/session/${encodeURIComponent(sessionID)}/prompt_async`, {
    method: "POST",
    body: JSON.stringify({
      parts: createPromptParts(content, attachments),
    }),
  })
}

export async function sendPromptAsync(sessionID: string, content: string, attachments: Array<PromptAttachment | string>) {
  await request(`/session/${encodeURIComponent(sessionID)}/prompt_async`, {
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

export async function subscribeEvents(handlers: SubscribeHandlers | ((event: ApiEvent) => void)) {
  if (!getStoredToken()) {
    return () => {}
  }
  const normalized: SubscribeHandlers = typeof handlers === "function" ? { onEvent: handlers } : handlers
  const source = new EventSource(`${baseUrl}/global/event`)

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

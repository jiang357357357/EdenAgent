import type {
  MetaPartCard,
  MessageData,
  MessageSegment,
  PendingPermission,
  PendingQuestion,
  RuntimeAgentPart,
  RuntimeCompactionPart,
  RuntimeFilePart,
  RuntimeMessage,
  RuntimePatchPart,
  RuntimePart,
  RuntimeReasoningPart,
  RuntimeRetryPart,
  RuntimeSession,
  RuntimeSnapshotPart,
  RuntimeState,
  RuntimeStepFinishPart,
  RuntimeStepStartPart,
  RuntimeSubtaskPart,
  RuntimeTextPart,
  RuntimeToolPart,
  Session,
  ToolCall,
} from "../types"
import { formatLocalTime } from "./time"

function isRuntimeTextPart(part: RuntimePart): part is RuntimeTextPart {
  return part.type === "text" && "text" in part && typeof part.text === "string"
}

function isRuntimeReasoningPart(part: RuntimePart): part is RuntimeReasoningPart {
  return part.type === "reasoning" && "text" in part && typeof part.text === "string"
}

function isRuntimeTracePart(part: RuntimeReasoningPart) {
  return part.source === "runtime" || part.id.endsWith("_runtime_thinking")
}

function isRuntimeFilePart(part: RuntimePart): part is RuntimeFilePart {
  return part.type === "file" && "mime" in part && typeof part.mime === "string" && "url" in part
}

function isRuntimeToolPart(part: RuntimePart): part is RuntimeToolPart {
  return part.type === "tool" && "tool" in part && typeof part.tool === "string" && "state" in part
}

function formatNumber(value?: number) {
  if (typeof value !== "number") return undefined
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
}

function mapMetaPart(part: RuntimePart): MetaPartCard | undefined {
  switch (part.type) {
    case "subtask": {
      const subtask = part as RuntimeSubtaskPart
      return {
        id: subtask.id,
        type: subtask.type,
        title: `Subtask: ${subtask.agent}`,
        summary: subtask.description,
        detail: [subtask.command, subtask.prompt].filter(Boolean).join("\n\n"),
        tone: "accent",
      }
    }
    case "step-start": {
      const stepStart = part as RuntimeStepStartPart
      return {
        id: stepStart.id,
        type: stepStart.type,
        title: "Step Started",
        summary: stepStart.snapshot ? "Snapshot captured for this step." : "Model step started.",
        detail: stepStart.snapshot,
        tone: "muted",
      }
    }
    case "step-finish": {
      const stepFinish = part as RuntimeStepFinishPart
      const tokenSummary = `input ${stepFinish.tokens.input}, output ${stepFinish.tokens.output}, reasoning ${stepFinish.tokens.reasoning}`
      return {
        id: stepFinish.id,
        type: stepFinish.type,
        title: "Step Finished",
        summary: `${stepFinish.reason} • ${tokenSummary}`,
        detail: `cost: ${formatNumber(stepFinish.cost) ?? stepFinish.cost}\ncache read: ${stepFinish.tokens.cache.read}\ncache write: ${stepFinish.tokens.cache.write}${stepFinish.snapshot ? `\n\n${stepFinish.snapshot}` : ""}`,
        tone: "default",
      }
    }
    case "snapshot": {
      const snapshot = part as RuntimeSnapshotPart
      return {
        id: snapshot.id,
        type: snapshot.type,
        title: "Snapshot",
        summary: snapshot.snapshot,
        detail: snapshot.snapshot,
        tone: "muted",
      }
    }
    case "patch": {
      const patch = part as RuntimePatchPart
      return {
        id: patch.id,
        type: patch.type,
        title: "Patch",
        summary: `${patch.files.length} file${patch.files.length === 1 ? "" : "s"}`,
        detail: [`hash: ${patch.hash}`, ...patch.files].join("\n"),
        tone: "accent",
      }
    }
    case "agent": {
      const agent = part as RuntimeAgentPart
      return {
        id: agent.id,
        type: agent.type,
        title: `Agent: ${agent.name}`,
        summary: agent.source?.value,
        detail: agent.source?.value,
        tone: "default",
      }
    }
    case "retry": {
      const retry = part as RuntimeRetryPart
      return {
        id: retry.id,
        type: retry.type,
        title: `Retry ${retry.attempt}`,
        summary: retry.error.message ?? "Provider retry triggered.",
        detail: retry.error.statusCode ? `status: ${retry.error.statusCode}` : undefined,
        tone: "warning",
      }
    }
    case "compaction": {
      const compaction = part as RuntimeCompactionPart
      return {
        id: compaction.id,
        type: compaction.type,
        title: compaction.auto ? "Auto Compaction" : "Compaction",
        summary: compaction.overflow ? "Context overflow triggered summarization." : "Context was compacted.",
        detail: compaction.tail_start_id ? `tail start: ${compaction.tail_start_id}` : undefined,
        tone: "muted",
      }
    }
    default:
      return undefined
  }
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

function mapTool(part: RuntimeToolPart): ToolCall {
  const state = part.state
  const start = state.time?.start
  const end = state.time?.end
  return {
    id: part.id,
    name: part.tool,
    status: state.status === "completed" ? "success" : state.status === "error" ? "error" : "running",
    input: stringify("input" in state ? state.input : {}),
    output: state.status === "completed" ? state.output : undefined,
    error: state.status === "error" ? state.error : undefined,
    duration: start && end ? end - start : undefined,
  }
}

function partsInOrder(message: RuntimeMessage) {
  return message.partOrder.map((partID) => message.parts[partID]).filter(Boolean)
}

function userMessageSignature(message: RuntimeMessage) {
  if (message.role !== "user") return undefined
  const parts = partsInOrder(message)
  const text = parts
    .filter(isRuntimeTextPart)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim()
  const images = parts
    .filter((part): part is RuntimeFilePart => isRuntimeFilePart(part) && part.mime.startsWith("image/"))
    .map((part) => `${part.filename ?? ""}:${part.url}`)
  if (!text && images.length === 0) return undefined
  return `${text}||${images.join("|")}`
}

function visibleMessages(session: RuntimeSession) {
  const serverUserSignatures = new Set<string>()
  for (const messageID of session.messageOrder) {
    const message = session.messages[messageID]
    if (!message || message.localOnly || message.role !== "user") continue
    const signature = userMessageSignature(message)
    if (signature) serverUserSignatures.add(signature)
  }

  return session.messageOrder
    .map((messageID) => session.messages[messageID])
    .filter(Boolean)
    .filter((message) => {
      if (!message.localOnly || message.role !== "user") return true
      const signature = userMessageSignature(message)
      return !signature || !serverUserSignatures.has(signature)
    })
}

function mapMessage(message: RuntimeMessage): MessageData {
  const parts = partsInOrder(message)
  const textParts = parts.filter(isRuntimeTextPart)
  const reasoningParts = parts.filter(isRuntimeReasoningPart)
  const runtimeTraceParts = reasoningParts.filter(isRuntimeTracePart)
  const modelReasoningParts = reasoningParts.filter((part) => !isRuntimeTracePart(part))
  const toolParts = parts.filter(isRuntimeToolPart)
  const content = textParts
    .map((part) => part.text)
    .join("\n")
    .trim()
  const runtimeTrace = runtimeTraceParts
    .map((part) => part.text)
    .join("\n")
    .trim()
  const thinking = modelReasoningParts
    .map((part) => part.text)
    .join("\n")
    .trim()
  const images = parts
    .filter((part): part is RuntimeFilePart => isRuntimeFilePart(part) && part.mime.startsWith("image/"))
    .map((part) => part.url)
  const toolCalls = toolParts.map(mapTool)
  const metaParts = parts.map(mapMetaPart).filter((part): part is MetaPartCard => Boolean(part))
  const hasRunningTool = toolParts.some((part) => part.state.status === "pending" || part.state.status === "running")
  const isStreaming =
    message.role === "assistant" &&
    (!message.completedAt ||
      textParts.some((part) => !part.done) ||
      reasoningParts.some((part) => !part.done) ||
      hasRunningTool)
  const runtimeTraceState = runtimeTrace
    ? runtimeTraceParts.some((part) => !part.done)
      ? "streaming"
      : "done"
    : undefined
  const thinkingState = thinking ? (modelReasoningParts.some((part) => !part.done) ? "streaming" : "done") : undefined
  const segments = parts
    .flatMap((part): MessageSegment[] => {
      if (isRuntimeTextPart(part)) {
        return part.text
          ? [
              {
                id: part.id,
                type: "text",
                content: part.text,
                state: part.done ? "done" : "streaming",
              },
            ]
          : []
      }
      if (isRuntimeReasoningPart(part)) {
        if (!part.text) return []
        return [
          {
            id: part.id,
            type: isRuntimeTracePart(part) ? "runtimeTrace" : "thinking",
            content: part.text,
            state: part.done ? "done" : "streaming",
          },
        ]
      }
      if (isRuntimeToolPart(part)) {
        return [{ id: part.id, type: "tool", tool: mapTool(part) }]
      }
      if (isRuntimeFilePart(part) && part.mime.startsWith("image/")) {
        return [{ id: part.id, type: "image", url: part.url, filename: part.filename }]
      }
      const metaPart = mapMetaPart(part)
      return metaPart ? [{ id: part.id, type: "meta", part: metaPart }] : []
    })
    .filter((segment) => {
      if (message.role !== "assistant") return true
      if (segment.type === "image") return true
      if (segment.type === "text") return Boolean(segment.content.trim())
      if (segment.type === "runtimeTrace" || segment.type === "thinking") return Boolean(segment.content.trim())
      return true
    })

  return {
    id: message.id,
    role: message.role,
    content,
    timestamp: timeLabel(message.createdAt),
    segments: segments.length ? segments : undefined,
    runtimeTrace: runtimeTrace || undefined,
    runtimeTraceState,
    thinking: thinking || undefined,
    thinkingState,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    metaParts: metaParts.length ? metaParts : undefined,
    images: images.length ? images : undefined,
    isStreaming,
  }
}

function mapSession(session: RuntimeSession): Session {
  const messages = visibleMessages(session).map(mapMessage)
  return {
    id: session.id,
    title: session.title || "新会话",
    date: timeLabel(session.updatedAt),
    messages,
  }
}

export function selectSessions(state: RuntimeState): Session[] {
  return state.sessionOrder
    .map((sessionID) => state.sessions[sessionID])
    .filter(Boolean)
    .map(mapSession)
}

export function selectActiveSession(state: RuntimeState): Session | undefined {
  if (!state.activeSessionId) return undefined
  const session = state.sessions[state.activeSessionId]
  return session ? mapSession(session) : undefined
}

export function selectSessionStatus(state: RuntimeState, sessionID?: string) {
  if (!sessionID) return "idle" as const
  return state.sessions[sessionID]?.status ?? "idle"
}

export function selectPendingPermissions(state: RuntimeState, sessionID?: string): PendingPermission[] {
  if (!sessionID) return []
  return state.permissionOrder
    .map((requestID) => state.permissions[requestID])
    .filter((request): request is PendingPermission => Boolean(request && request.sessionID === sessionID))
}

export function selectPendingQuestions(state: RuntimeState, sessionID?: string): PendingQuestion[] {
  if (!sessionID) return []
  return state.questionOrder
    .map((requestID) => state.questions[requestID])
    .filter((request): request is PendingQuestion => Boolean(request && request.sessionID === sessionID))
}

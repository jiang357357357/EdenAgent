import type {
  ApiEvent,
  ApiAgentPart,
  ApiCompactionPart,
  ApiMessage,
  ApiMessageInfo,
  ApiPatchPart,
  ApiPart,
  ApiRetryPart,
  ApiSession,
  ApiSnapshotPart,
  ApiStepFinishPart,
  ApiStepStartPart,
  ApiSubtaskPart,
} from "./mon_agent_api"
import {
  isApiAgentPart,
  isApiCompactionPart,
  isApiFilePart,
  isApiPatchPart,
  isApiReasoningPart,
  isApiRetryPart,
  isApiSnapshotPart,
  isApiStepFinishPart,
  isApiStepStartPart,
  isApiSubtaskPart,
  isApiTextPart,
  isApiToolPart,
} from "./mon_agent_api"
import type {
  PendingPermission,
  PendingQuestion,
  PromptAttachment,
  Role,
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
  RuntimeUnknownPart,
} from "../types"

type RuntimeAction =
  | { type: "reset" }
  | { type: "hydrateSessions"; sessions: ApiSession[] }
  | { type: "hydrateMessages"; sessionID: string; messages: ApiMessage[] }
  | { type: "hydratePermissions"; permissions: PendingPermission[] }
  | { type: "hydrateQuestions"; questions: PendingQuestion[] }
  | { type: "setActiveSession"; sessionID?: string }
  | { type: "localUserMessage"; sessionID: string; content: string; attachments: PromptAttachment[] }
  | { type: "event"; event: ApiEvent }
  | { type: "connectionState"; state: RuntimeState["connectionState"] }
  | { type: "connectionError"; error?: string }

export const initialRuntimeState: RuntimeState = {
  sessions: {},
  sessionOrder: [],
  permissions: {},
  permissionOrder: [],
  questions: {},
  questionOrder: [],
  activeSessionId: undefined,
  connectionState: "connecting",
  connectionError: undefined,
}

function sortIdsByValue(order: string[]) {
  order.sort((left, right) => left.localeCompare(right))
}

function upsertPermission(state: RuntimeState, permission: PendingPermission) {
  state.permissions[permission.id] = permission
  if (!state.permissionOrder.includes(permission.id)) {
    state.permissionOrder.push(permission.id)
  }
  sortIdsByValue(state.permissionOrder)
}

function removePermission(state: RuntimeState, requestID: string) {
  if (!state.permissions[requestID]) return
  delete state.permissions[requestID]
  state.permissionOrder = state.permissionOrder.filter((id) => id !== requestID)
}

function replacePermissions(state: RuntimeState, permissions: PendingPermission[]) {
  state.permissions = {}
  state.permissionOrder = []
  for (const permission of permissions) {
    upsertPermission(state, permission)
  }
}

function upsertQuestion(state: RuntimeState, question: PendingQuestion) {
  state.questions[question.id] = question
  if (!state.questionOrder.includes(question.id)) {
    state.questionOrder.push(question.id)
  }
  sortIdsByValue(state.questionOrder)
}

function removeQuestion(state: RuntimeState, requestID: string) {
  if (!state.questions[requestID]) return
  delete state.questions[requestID]
  state.questionOrder = state.questionOrder.filter((id) => id !== requestID)
}

function replaceQuestions(state: RuntimeState, questions: PendingQuestion[]) {
  state.questions = {}
  state.questionOrder = []
  for (const question of questions) {
    upsertQuestion(state, question)
  }
}

function upsertSession(state: RuntimeState, info: ApiSession): RuntimeSession {
  const existing = state.sessions[info.id]
  const session: RuntimeSession = existing
    ? {
        ...existing,
        title: info.title || existing.title || "新会话",
        createdAt: info.time.created,
        updatedAt: info.time.updated,
      }
    : {
        id: info.id,
        title: info.title || "新会话",
        status: "idle",
        messageOrder: [],
        messages: {},
        createdAt: info.time.created,
        updatedAt: info.time.updated,
        hydrated: false,
      }
  state.sessions[info.id] = session
  if (!state.sessionOrder.includes(info.id)) {
    state.sessionOrder.push(info.id)
  }
  state.sessionOrder.sort((left, right) => {
    const leftTime = state.sessions[left]?.updatedAt ?? 0
    const rightTime = state.sessions[right]?.updatedAt ?? 0
    return rightTime - leftTime
  })
  return session
}

function ensureSession(state: RuntimeState, sessionID: string): RuntimeSession {
  const existing = state.sessions[sessionID]
  if (existing) return existing
  const session: RuntimeSession = {
    id: sessionID,
    title: "新会话",
    status: "idle",
    messageOrder: [],
    messages: {},
    hydrated: false,
  }
  state.sessions[sessionID] = session
  state.sessionOrder.push(sessionID)
  return session
}

function optimisticTimestamp() {
  return Date.now()
}

function ensureMessage(session: RuntimeSession, info: { id: string; role: Role; sessionID: string }): RuntimeMessage {
  const existing = session.messages[info.id]
  if (existing) {
    if (existing.role !== info.role) {
      existing.role = info.role
    }
    return existing
  }

  const message: RuntimeMessage = {
    id: info.id,
    role: info.role,
    sessionID: info.sessionID,
    partOrder: [],
    parts: {},
  }
  session.messages[info.id] = message
  session.messageOrder.push(info.id)
  return message
}

function ensureTextPart(
  message: RuntimeMessage,
  partID: string,
  type: "text" | "reasoning",
): RuntimeTextPart | RuntimeReasoningPart {
  const existing = message.parts[partID]
  if (
    existing &&
    (existing.type === "text" || existing.type === "reasoning") &&
    "text" in existing &&
    typeof existing.text === "string"
  ) {
    return existing
  }
  const part =
    type === "text"
      ? ({ id: partID, type, text: "", done: false } satisfies RuntimeTextPart)
      : ({ id: partID, type, text: "", done: false } satisfies RuntimeReasoningPart)
  message.parts[partID] = part
  if (!message.partOrder.includes(partID)) {
    message.partOrder.push(partID)
  }
  return part
}

function isRuntimeToolRuntimePart(part: RuntimePart | undefined): part is RuntimeToolPart {
  return Boolean(part && part.type === "tool" && "state" in part)
}

function isTerminalToolState(status: RuntimeToolPart["state"]["status"]) {
  return status === "completed" || status === "error"
}

function upsertPart(message: RuntimeMessage, part: RuntimePart) {
  const existing = message.parts[part.id]
  if (isRuntimeToolRuntimePart(existing) && isRuntimeToolRuntimePart(part)) {
    if (isTerminalToolState(existing.state.status) && !isTerminalToolState(part.state.status)) {
      return
    }
  }
  message.parts[part.id] = part
  if (!message.partOrder.includes(part.id)) {
    message.partOrder.push(part.id)
  }
}

function mapPart(part: ApiPart): RuntimePart {
  if (isApiTextPart(part)) {
    return {
      id: part.id,
      type: "text",
      text: part.text,
      done: Boolean(part.time?.end),
    }
  }
  if (isApiReasoningPart(part)) {
    return {
      id: part.id,
      type: "reasoning",
      text: part.text,
      done: Boolean(part.time?.end),
      source: part.source,
      title: part.title,
    }
  }
  if (isApiFilePart(part)) {
    const filePart: RuntimeFilePart = {
      id: part.id,
      type: "file",
      mime: part.mime,
      url: part.url,
      filename: part.filename,
    }
    return filePart
  }
  if (isApiSnapshotPart(part)) {
    const snapshotPart: RuntimeSnapshotPart = {
      id: part.id,
      type: "snapshot",
      snapshot: part.snapshot,
    }
    return snapshotPart
  }
  if (isApiPatchPart(part)) {
    const patchPart: RuntimePatchPart = {
      id: part.id,
      type: "patch",
      hash: part.hash,
      files: part.files,
    }
    return patchPart
  }
  if (isApiAgentPart(part)) {
    const agentPart: RuntimeAgentPart = {
      id: part.id,
      type: "agent",
      name: part.name,
      source: part.source,
    }
    return agentPart
  }
  if (isApiCompactionPart(part)) {
    const compactionPart: RuntimeCompactionPart = {
      id: part.id,
      type: "compaction",
      auto: part.auto,
      overflow: part.overflow,
      tail_start_id: part.tail_start_id,
    }
    return compactionPart
  }
  if (isApiSubtaskPart(part)) {
    const subtaskPart: RuntimeSubtaskPart = {
      id: part.id,
      type: "subtask",
      prompt: part.prompt,
      description: part.description,
      agent: part.agent,
      command: part.command,
      model: part.model,
    }
    return subtaskPart
  }
  if (isApiRetryPart(part)) {
    const retryPart: RuntimeRetryPart = {
      id: part.id,
      type: "retry",
      attempt: part.attempt,
      error: part.error,
      time: part.time,
    }
    return retryPart
  }
  if (isApiStepStartPart(part)) {
    const stepStartPart: RuntimeStepStartPart = {
      id: part.id,
      type: "step-start",
      snapshot: part.snapshot,
    }
    return stepStartPart
  }
  if (isApiStepFinishPart(part)) {
    const stepFinishPart: RuntimeStepFinishPart = {
      id: part.id,
      type: "step-finish",
      reason: part.reason,
      snapshot: part.snapshot,
      cost: part.cost,
      tokens: part.tokens,
    }
    return stepFinishPart
  }
  if (isApiToolPart(part)) {
    const toolPart: RuntimeToolPart = {
      id: part.id,
      type: "tool",
      tool: part.tool,
      state: part.state,
    }
    return toolPart
  }
  const { id, type, ...raw } = part
  const unknownPart: RuntimeUnknownPart = {
    id,
    type,
    raw,
  }
  return unknownPart
}

function applyMessageInfo(message: RuntimeMessage, info: ApiMessageInfo) {
  message.role = info.role
  message.createdAt = info.time.created
  if (info.role === "assistant") {
    message.completedAt = info.time.completed
  }
  message.localOnly = false
}

function replaceSessionMessages(session: RuntimeSession, messages: ApiMessage[]) {
  session.messages = {}
  session.messageOrder = []
  for (const item of messages) {
    const message = ensureMessage(session, {
      id: item.info.id,
      role: item.info.role,
      sessionID: session.id,
    })
    applyMessageInfo(message, item.info)
    for (const part of item.parts) {
      upsertPart(message, mapPart(part))
    }
  }
  session.hydrated = true
}

function userMessageSignature(message: RuntimeMessage) {
  if (message.role !== "user") return
  const text = message.partOrder
    .map((partID) => message.parts[partID])
    .filter((part): part is RuntimeTextPart => Boolean(part && part.type === "text"))
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim()
  const images = message.partOrder
    .map((partID) => message.parts[partID])
    .filter((part): part is RuntimeFilePart =>
      Boolean(
        part &&
          part.type === "file" &&
          "mime" in part &&
          typeof part.mime === "string" &&
          part.mime.startsWith("image/") &&
          "url" in part &&
          typeof part.url === "string",
      ),
    )
    .map((part) => `${part.filename ?? ""}:${part.url}`)

  if (!text && images.length === 0) return
  return `${text}||${images.join("|")}`
}

function removeMessage(session: RuntimeSession, messageID: string) {
  delete session.messages[messageID]
  session.messageOrder = session.messageOrder.filter((id) => id !== messageID)
}

function reconcileOptimisticUsers(session: RuntimeSession) {
  const serverBySignature = new Map<string, string>()

  for (const messageID of session.messageOrder) {
    const message = session.messages[messageID]
    if (!message || message.localOnly || message.role !== "user") continue
    const signature = userMessageSignature(message)
    if (!signature) continue
    serverBySignature.set(signature, message.id)
  }

  if (serverBySignature.size === 0) return

  for (const messageID of [...session.messageOrder]) {
    const message = session.messages[messageID]
    if (!message?.localOnly || message.role !== "user") continue
    const signature = userMessageSignature(message)
    if (!signature) continue
    if (!serverBySignature.has(signature)) continue
    removeMessage(session, messageID)
  }
}

function removeOptimisticMatch(session: RuntimeSession, serverMessageID: string, text: string) {
  const normalized = text.trim()
  if (!normalized) return
  for (const messageID of [...session.messageOrder]) {
    if (messageID === serverMessageID) continue
    const message = session.messages[messageID]
    if (!message?.localOnly || message.role !== "user") continue
    const content = message.partOrder
      .map((partID) => message.parts[partID])
      .filter((part): part is RuntimeTextPart => Boolean(part && part.type === "text"))
      .map((part) => part.text)
      .join("\n")
      .trim()
    if (content !== normalized) continue
    removeMessage(session, messageID)
    return
  }
}

function applyPartUpdate(state: RuntimeState, part: ApiPart) {
  const session = ensureSession(state, part.sessionID)
  const message = ensureMessage(session, {
    id: part.messageID,
    role: session.messages[part.messageID]?.role ?? "assistant",
    sessionID: part.sessionID,
  })
  const mapped = mapPart(part)
  upsertPart(message, mapped)
  if ((isApiTextPart(part) || isApiReasoningPart(part)) && message.role === "user") {
    removeOptimisticMatch(session, message.id, part.text)
  }
  reconcileOptimisticUsers(session)
}

function applyPartDelta(state: RuntimeState, event: Extract<ApiEvent, { type: "message.part.delta" }>) {
  const session = ensureSession(state, event.properties.sessionID)
  const message = ensureMessage(session, {
    id: event.properties.messageID,
    role: session.messages[event.properties.messageID]?.role ?? "assistant",
    sessionID: event.properties.sessionID,
  })
  const existing = message.parts[event.properties.partID]
  const partType =
    existing?.type === "reasoning" || event.properties.partType === "reasoning" ? "reasoning" : "text"
  const part = ensureTextPart(message, event.properties.partID, partType)
  const baseLength = event.properties.baseLength
  const targetText = event.properties.targetText
  const canAppend =
    typeof baseLength !== "number" ||
    (part.text.length === baseLength &&
      (typeof targetText !== "string" || targetText.startsWith(part.text + event.properties.delta)))

  if (canAppend) {
    part.text += event.properties.delta
    if (typeof targetText === "string" && part.text !== targetText) {
      part.text = targetText
    }
  } else if (typeof targetText === "string") {
    part.text = targetText
  }
  part.done = Boolean(event.properties.time?.end)
  if (part.type === "reasoning") {
    part.source = event.properties.source
    part.title = event.properties.title
  }
  if (part.type === "text" && message.role === "user") {
    removeOptimisticMatch(session, message.id, part.text)
  }
}

function isSessionEvent(event: ApiEvent): event is Extract<ApiEvent, { type: "session.created" | "session.updated" }> {
  return (
    (event.type === "session.created" || event.type === "session.updated") &&
    !!event.properties &&
    typeof (event.properties as { info?: unknown }).info === "object"
  )
}

function isMessageUpdatedEvent(event: ApiEvent): event is Extract<ApiEvent, { type: "message.updated" }> {
  return event.type === "message.updated" && !!event.properties && typeof event.properties.sessionID === "string"
}

function isMessagePartUpdatedEvent(event: ApiEvent): event is Extract<ApiEvent, { type: "message.part.updated" }> {
  return (
    event.type === "message.part.updated" &&
    !!event.properties &&
    typeof (event.properties as { part?: unknown }).part === "object"
  )
}

function isMessagePartDeltaEvent(event: ApiEvent): event is Extract<ApiEvent, { type: "message.part.delta" }> {
  return (
    event.type === "message.part.delta" &&
    !!event.properties &&
    typeof (
      event.properties as {
        sessionID?: unknown
        messageID?: unknown
        partID?: unknown
        field?: unknown
        delta?: unknown
      }
    ).sessionID === "string" &&
    typeof (event.properties as { messageID?: unknown }).messageID === "string" &&
    typeof (event.properties as { partID?: unknown }).partID === "string" &&
    typeof (event.properties as { field?: unknown }).field === "string" &&
    typeof (event.properties as { delta?: unknown }).delta === "string"
  )
}

function isMessagePartRemovedEvent(event: ApiEvent): event is Extract<ApiEvent, { type: "message.part.removed" }> {
  return (
    event.type === "message.part.removed" &&
    !!event.properties &&
    typeof (event.properties as { sessionID?: unknown; messageID?: unknown; partID?: unknown }).sessionID ===
      "string" &&
    typeof (event.properties as { messageID?: unknown }).messageID === "string" &&
    typeof (event.properties as { partID?: unknown }).partID === "string"
  )
}

function isSessionStatusEvent(event: ApiEvent): event is Extract<ApiEvent, { type: "session.status" }> {
  return event.type === "session.status" && !!event.properties && typeof event.properties.sessionID === "string"
}

function isSessionErrorEvent(event: ApiEvent): event is Extract<ApiEvent, { type: "session.error" }> {
  return event.type === "session.error" && !!event.properties && typeof event.properties.sessionID === "string"
}

function isPermissionAskedEvent(event: ApiEvent): event is Extract<ApiEvent, { type: "permission.asked" }> {
  return event.type === "permission.asked" && !!event.properties && typeof event.properties.sessionID === "string"
}

function isPermissionRepliedEvent(event: ApiEvent): event is Extract<ApiEvent, { type: "permission.replied" }> {
  return (
    event.type === "permission.replied" &&
    !!event.properties &&
    typeof event.properties.sessionID === "string" &&
    typeof event.properties.requestID === "string"
  )
}

function isQuestionAskedEvent(event: ApiEvent): event is Extract<ApiEvent, { type: "question.asked" }> {
  return event.type === "question.asked" && !!event.properties && typeof event.properties.sessionID === "string"
}

function isQuestionResolvedEvent(
  event: ApiEvent,
): event is Extract<ApiEvent, { type: "question.replied" | "question.rejected" }> {
  return (
    (event.type === "question.replied" || event.type === "question.rejected") &&
    !!event.properties &&
    typeof event.properties.sessionID === "string" &&
    typeof event.properties.requestID === "string"
  )
}

function applyMessageUpdate(state: RuntimeState, sessionID: string, info: ApiMessageInfo) {
  const session = ensureSession(state, sessionID)
  const message = ensureMessage(session, {
    id: info.id,
    role: info.role,
    sessionID,
  })
  applyMessageInfo(message, info)
  reconcileOptimisticUsers(session)
}

function createOptimisticUserMessage(sessionID: string, content: string, attachments: PromptAttachment[]): RuntimeMessage {
  const createdAt = optimisticTimestamp()
  const message: RuntimeMessage = {
    id: `local-user-${createdAt}`,
    sessionID,
    role: "user",
    createdAt,
    localOnly: true,
    partOrder: [],
    parts: {},
  }

  if (content.trim()) {
    const textPart: RuntimeTextPart = {
      id: `local-text-${createdAt}`,
      type: "text",
      text: content.trim(),
      done: true,
    }
    upsertPart(message, textPart)
  }

  attachments.forEach((attachment, index) => {
    const filePart: RuntimeFilePart = {
      id: `local-file-${createdAt}-${index}`,
      type: "file",
      mime: attachment.mime,
      url: attachment.url,
      filename: attachment.filename ?? `attachment-${index + 1}`,
    }
    upsertPart(message, filePart)
  })

  return message
}

export function runtimeReducer(state: RuntimeState, action: RuntimeAction): RuntimeState {
  if (action.type === "reset") {
    return {
      sessions: {},
      sessionOrder: [],
      permissions: {},
      permissionOrder: [],
      questions: {},
      questionOrder: [],
      activeSessionId: undefined,
      connectionState: "connecting",
      connectionError: undefined,
    }
  }

  const next: RuntimeState = {
    ...state,
    sessions: { ...state.sessions },
    sessionOrder: [...state.sessionOrder],
    permissions: { ...state.permissions },
    permissionOrder: [...state.permissionOrder],
    questions: { ...state.questions },
    questionOrder: [...state.questionOrder],
  }

  switch (action.type) {
    case "hydrateSessions": {
      for (const session of action.sessions) {
        upsertSession(next, session)
      }
      if (!next.activeSessionId && next.sessionOrder[0]) {
        next.activeSessionId = next.sessionOrder[0]
      }
      if (next.connectionState === "connecting") {
        next.connectionState = "connected"
      }
      next.connectionError = undefined
      return next
    }

    case "hydrateMessages": {
      const session = ensureSession(next, action.sessionID)
      replaceSessionMessages(session, action.messages)
      session.updatedAt = Math.max(
        session.updatedAt ?? 0,
        ...action.messages.map((message) => message.info.time.created),
      )
      next.connectionError = undefined
      return next
    }

    case "hydratePermissions":
      replacePermissions(next, action.permissions)
      return next

    case "hydrateQuestions":
      replaceQuestions(next, action.questions)
      return next

    case "setActiveSession":
      next.activeSessionId = action.sessionID
      return next

    case "localUserMessage": {
      const session = ensureSession(next, action.sessionID)
      const message = createOptimisticUserMessage(action.sessionID, action.content, action.attachments)
      session.messages = { ...session.messages, [message.id]: message }
      session.messageOrder = [...session.messageOrder, message.id]
      session.updatedAt = message.createdAt
      session.status = "busy"
      next.connectionError = undefined
      reconcileOptimisticUsers(session)
      return next
    }

    case "connectionError":
      next.connectionError = action.error
      if (action.error) {
        next.connectionState = "disconnected"
      }
      return next

    case "connectionState":
      next.connectionState = action.state
      if (action.state === "connected") {
        next.connectionError = undefined
      }
      return next

    case "event": {
      const event = action.event
      if (isSessionEvent(event)) {
        upsertSession(next, event.properties.info)
        return next
      }
      if (isMessageUpdatedEvent(event)) {
        applyMessageUpdate(next, event.properties.sessionID, event.properties.info)
        return next
      }
      if (isMessagePartUpdatedEvent(event)) {
        applyPartUpdate(next, event.properties.part)
        return next
      }
      if (isMessagePartDeltaEvent(event) && event.properties.field === "text") {
        applyPartDelta(next, event)
        return next
      }
      if (isMessagePartRemovedEvent(event)) {
        const session = next.sessions[event.properties.sessionID]
        const message = session?.messages[event.properties.messageID]
        if (message) {
          const { [event.properties.partID]: _removed, ...rest } = message.parts
          message.parts = rest
          message.partOrder = message.partOrder.filter((partID) => partID !== event.properties.partID)
        }
        return next
      }
      if (isSessionStatusEvent(event)) {
        const session = ensureSession(next, event.properties.sessionID)
        const status = event.properties.status.type
        session.status = status === "busy" || status === "retry" ? status : "idle"
        if (session.status === "idle") {
          session.error = undefined
        }
        return next
      }
      if (isSessionErrorEvent(event)) {
        const session = ensureSession(next, event.properties.sessionID)
        session.error =
          event.properties.error?.data?.message ?? event.properties.error?.message ?? event.properties.error?.name
        return next
      }
      if (isPermissionAskedEvent(event)) {
        upsertPermission(next, event.properties)
        return next
      }
      if (isPermissionRepliedEvent(event)) {
        removePermission(next, event.properties.requestID)
        return next
      }
      if (isQuestionAskedEvent(event)) {
        upsertQuestion(next, event.properties)
        return next
      }
      if (isQuestionResolvedEvent(event)) {
        removeQuestion(next, event.properties.requestID)
        return next
      }
      return next
    }

    default:
      return next
  }
}

export function hydrateSessionMessages(sessionID: string, messages: ApiMessage[]): RuntimeAction {
  return { type: "hydrateMessages", sessionID, messages }
}

export function hydrateSessionList(sessions: ApiSession[]): RuntimeAction {
  return { type: "hydrateSessions", sessions }
}

export function hydratePendingPermissions(permissions: PendingPermission[]): RuntimeAction {
  return { type: "hydratePermissions", permissions }
}

export function hydratePendingQuestions(questions: PendingQuestion[]): RuntimeAction {
  return { type: "hydrateQuestions", questions }
}

export function setActiveSession(sessionID?: string): RuntimeAction {
  return { type: "setActiveSession", sessionID }
}

export function pushLocalUserMessage(
  sessionID: string,
  content: string,
  attachments: PromptAttachment[],
): RuntimeAction {
  return { type: "localUserMessage", sessionID, content, attachments }
}

export function applyRuntimeEvent(event: ApiEvent): RuntimeAction {
  return { type: "event", event }
}

export function setConnectionError(error?: string): RuntimeAction {
  return { type: "connectionError", error }
}

export function setConnectionState(state: RuntimeState["connectionState"]): RuntimeAction {
  return { type: "connectionState", state }
}

export function resetRuntime(): RuntimeAction {
  return { type: "reset" }
}

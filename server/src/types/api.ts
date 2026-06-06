import type { AgentMessage } from "@earendil-works/pi-agent-core"

export type Role = "user" | "assistant"
export type PermissionReply = "once" | "always" | "reject"

export interface ApiSession {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export interface ApiMessageInfo {
  id: string
  role: Role
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

export interface ApiTextPart {
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

export interface ApiReasoningPart {
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

export interface ApiFilePart {
  id: string
  messageID: string
  sessionID: string
  type: "file"
  mime: string
  url: string
  filename?: string
}

export interface ApiToolPart {
  id: string
  messageID: string
  sessionID: string
  type: "tool"
  tool: string
  state:
    | { status: "pending" | "running"; input?: unknown; time?: { start?: number; end?: number } }
    | { status: "completed"; input?: unknown; output: string; time?: { start?: number; end?: number } }
    | { status: "error"; input?: unknown; error: string; time?: { start?: number; end?: number } }
}

export type ApiPart = ApiTextPart | ApiReasoningPart | ApiFilePart | ApiToolPart

export interface ApiMessage {
  info: ApiMessageInfo
  parts: ApiPart[]
}

export interface PromptTextPart {
  type: "text"
  text: string
}

export interface PromptFilePart {
  type: "file"
  url: string
  filename?: string
  mime?: string
  size?: number
}

export type PromptPart = PromptTextPart | PromptFilePart

export interface PendingPermission {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: {
    messageID: string
    callID: string
  }
}

export interface QuestionOption {
  label: string
  description: string
}

export interface PendingQuestionItem {
  header: string
  question: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface PendingQuestion {
  id: string
  sessionID: string
  questions: PendingQuestionItem[]
  tool?: {
    messageID: string
    callID: string
  }
}

export type ApiEvent =
  | { type: "session.created" | "session.updated"; properties: { sessionID: string; info: ApiSession } }
  | { type: "session.status"; properties: { sessionID: string; status: { type: "idle" | "busy" | "retry" | string } } }
  | { type: "session.error"; properties: { sessionID: string; error: ApiMessageInfo["error"] } }
  | { type: "message.updated"; properties: { sessionID: string; info: ApiMessageInfo } }
  | { type: "message.part.updated"; properties: { sessionID: string; part: ApiPart; time?: number } }
  | {
      type: "message.part.delta"
      properties: {
        sessionID: string
        messageID: string
        partID: string
        field: "text"
        delta: string
        baseLength?: number
        targetText?: string
        partType?: "text" | "reasoning"
        source?: "runtime" | "model"
        title?: string
        time?: { start?: number; end?: number }
      }
    }
  | { type: "permission.asked"; properties: PendingPermission }
  | { type: "permission.replied"; properties: { sessionID: string; requestID: string; reply: PermissionReply } }
  | { type: "question.asked"; properties: PendingQuestion }
  | { type: "question.replied"; properties: { sessionID: string; requestID: string; answers: string[][] } }
  | { type: "question.rejected"; properties: { sessionID: string; requestID: string } }

export interface StoredSession {
  info: ApiSession
  messages: ApiMessage[]
  agentMessages: AgentMessage[]
}

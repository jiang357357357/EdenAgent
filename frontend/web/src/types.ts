export type Role = "user" | "assistant"
export type SessionStatus = "idle" | "busy" | "retry"
export type ConnectionState = "connecting" | "connected" | "disconnected"

export interface ToolCall {
  id: string
  name: string
  status: "running" | "success" | "error"
  input: string
  output?: string
  duration?: number
  error?: string
}

export interface MetaPartCard {
  id: string
  type: string
  title: string
  summary?: string
  detail?: string
  tone?: "default" | "muted" | "accent" | "warning"
}

export interface PermissionToolRef {
  messageID: string
  callID: string
}

export interface PendingPermission {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: PermissionToolRef
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
  tool?: PermissionToolRef
}

export interface MessageData {
  id: string
  role: Role
  content: string
  timestamp: string
  segments?: MessageSegment[]
  runtimeTrace?: string
  runtimeTraceState?: "streaming" | "done"
  thinking?: string
  thinkingState?: "streaming" | "done"
  toolCalls?: ToolCall[]
  metaParts?: MetaPartCard[]
  images?: string[]
  isStreaming?: boolean
}

export type MessageSegment =
  | {
      id: string
      type: "text"
      content: string
      state?: "streaming" | "done"
    }
  | {
      id: string
      type: "runtimeTrace"
      content: string
      state?: "streaming" | "done"
    }
  | {
      id: string
      type: "thinking"
      content: string
      state?: "streaming" | "done"
    }
  | {
      id: string
      type: "tool"
      tool: ToolCall
    }
  | {
      id: string
      type: "meta"
      part: MetaPartCard
    }
  | {
      id: string
      type: "image"
      url: string
      filename?: string
    }

export interface PromptAttachment {
  url: string
  mime: string
  filename?: string
  size?: number
}

export interface Session {
  id: string
  title: string
  date: string
  messages: MessageData[]
}

export interface RuntimeTextPart {
  id: string
  type: "text"
  text: string
  done: boolean
}

export interface RuntimeReasoningPart {
  id: string
  type: "reasoning"
  text: string
  done: boolean
  source?: "runtime" | "model"
  title?: string
}

export interface RuntimeFilePart {
  id: string
  type: "file"
  mime: string
  url: string
  filename?: string
}

export interface RuntimeSnapshotPart {
  id: string
  type: "snapshot"
  snapshot: string
}

export interface RuntimePatchPart {
  id: string
  type: "patch"
  hash: string
  files: string[]
}

export interface RuntimeAgentPart {
  id: string
  type: "agent"
  name: string
  source?: {
    value: string
    start: number
    end: number
  }
}

export interface RuntimeCompactionPart {
  id: string
  type: "compaction"
  auto: boolean
  overflow?: boolean
  tail_start_id?: string
}

export interface RuntimeSubtaskPart {
  id: string
  type: "subtask"
  prompt: string
  description: string
  agent: string
  command?: string
  model?: {
    providerID: string
    modelID: string
  }
}

export interface RuntimeRetryPart {
  id: string
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

export interface RuntimeStepStartPart {
  id: string
  type: "step-start"
  snapshot?: string
}

export interface RuntimeStepFinishPart {
  id: string
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

export interface RuntimeToolPart {
  id: string
  type: "tool"
  tool: string
  state:
    | { status: "pending" | "running"; input?: unknown; time?: { start?: number; end?: number } }
    | {
        status: "completed"
        input?: unknown
        output: string
        time?: { start?: number; end?: number; compacted?: number }
      }
    | { status: "error"; input?: unknown; error: string; time?: { start?: number; end?: number } }
}

export interface RuntimeUnknownPart {
  id: string
  type: string
  raw: Record<string, unknown>
}

export type RuntimePart =
  | RuntimeTextPart
  | RuntimeReasoningPart
  | RuntimeFilePart
  | RuntimeSnapshotPart
  | RuntimePatchPart
  | RuntimeAgentPart
  | RuntimeCompactionPart
  | RuntimeSubtaskPart
  | RuntimeRetryPart
  | RuntimeStepStartPart
  | RuntimeStepFinishPart
  | RuntimeToolPart
  | RuntimeUnknownPart

export interface RuntimeMessage {
  id: string
  sessionID: string
  role: Role
  partOrder: string[]
  parts: Record<string, RuntimePart>
  createdAt?: number
  completedAt?: number
  localOnly?: boolean
}

export interface RuntimeSession {
  id: string
  title: string
  status: SessionStatus
  messageOrder: string[]
  messages: Record<string, RuntimeMessage>
  createdAt?: number
  updatedAt?: number
  hydrated: boolean
  error?: string
}

export interface RuntimeState {
  sessions: Record<string, RuntimeSession>
  sessionOrder: string[]
  permissions: Record<string, PendingPermission>
  permissionOrder: string[]
  questions: Record<string, PendingQuestion>
  questionOrder: string[]
  activeSessionId?: string
  connectionState: ConnectionState
  connectionError?: string
}

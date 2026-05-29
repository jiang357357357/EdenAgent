import type {
  MoncoreCreateMessageInput,
  MoncoreCreateSessionInput,
  MoncoreSessionMap,
} from "./types"

export function toMoncoreSessionCreate(input: {
  sessionID: string
  title?: string
  assistantID?: number | string | null
  characterID?: number | string | null
  sessionPayload?: Record<string, unknown> | null
}): MoncoreCreateSessionInput {
  return {
    source: "opencode",
    external_session_id: input.sessionID,
    assistant: input.assistantID ?? null,
    character: input.characterID ?? null,
    title: input.title ?? "",
    session_payload: input.sessionPayload ?? null,
    status: "active",
  }
}

export function toMoncoreMessageCreate(input: {
  messageID: string
  parentMessageID?: string
  kind: string
  messagePayload?: Record<string, unknown> | null
  moncoreMessageUUID?: string | null
  moncoreStepUUID?: string | null
  toolCallID?: string
}): MoncoreCreateMessageInput {
  return {
    external_message_id: input.messageID,
    external_parent_message_id: input.parentMessageID,
    kind: input.kind,
    message_payload: input.messagePayload ?? null,
    moncore_message_uuid: input.moncoreMessageUUID ?? null,
    moncore_step_uuid: input.moncoreStepUUID ?? null,
    tool_call_id: input.toolCallID,
    sync_status: "pending",
  }
}

export function getSessionMapID(session: MoncoreSessionMap): string {
  return String(session.id)
}

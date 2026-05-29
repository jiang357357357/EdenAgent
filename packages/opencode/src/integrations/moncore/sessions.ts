import { moncoreRequest } from "./client"
import type {
  MoncoreCreateMessageInput,
  MoncoreCreateSessionInput,
  MoncoreMessageMap,
  MoncoreSessionMap,
  MoncoreUpdateSessionInput,
  MoncoreUpdateMessageInput,
} from "./types"

export async function listSessionMaps() {
  return moncoreRequest<MoncoreSessionMap[]>("api/opencode/sessions/")
}

export async function getSessionMap(sessionID: string | number) {
  return moncoreRequest<MoncoreSessionMap>(`api/opencode/sessions/${sessionID}/`)
}

export async function createSessionMap(input: MoncoreCreateSessionInput) {
  return moncoreRequest<MoncoreSessionMap>("api/opencode/sessions/", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateSessionMap(sessionID: string | number, input: MoncoreUpdateSessionInput) {
  return moncoreRequest<MoncoreSessionMap>(`api/opencode/sessions/${sessionID}/`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export async function deleteSessionMap(sessionID: string | number) {
  return moncoreRequest<void>(`api/opencode/sessions/${sessionID}/`, {
    method: "DELETE",
  })
}

export async function listMessageMaps(sessionID: string | number) {
  return moncoreRequest<MoncoreMessageMap[]>(`api/opencode/sessions/${sessionID}/messages/`)
}

export async function createMessageMap(sessionID: string | number, input: MoncoreCreateMessageInput) {
  return moncoreRequest<MoncoreMessageMap>(`api/opencode/sessions/${sessionID}/messages/`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateMessageMap(sessionID: string | number, messageID: string | number, input: MoncoreUpdateMessageInput) {
  return moncoreRequest<MoncoreMessageMap>(`api/opencode/sessions/${sessionID}/messages/?id=${encodeURIComponent(String(messageID))}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export async function deleteMessageMap(sessionID: string | number, messageID: string | number) {
  return moncoreRequest<void>(`api/opencode/sessions/${sessionID}/messages/?id=${encodeURIComponent(String(messageID))}`, {
    method: "DELETE",
  })
}

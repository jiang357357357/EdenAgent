export type MoncoreID = number | string
export type MoncoreJsonObject = Record<string, unknown>

export type MoncoreUser = {
  id: MoncoreID
  username: string
  role?: string
}

export type MoncoreOpencodeSettings = {
  id: MoncoreID
  enabled: boolean
  default_character: MoncoreID | null
  default_assistant: MoncoreID | null
  enable_history_sync: boolean
  enable_message_persistence: boolean
  enable_character_state_sync: boolean
  default_mode: "chat" | "character"
  default_model: string
  created_at: string
  updated_at: string
}

export type MoncoreCharacter = {
  id: MoncoreID
  name: string
  description?: string
  avatar?: string | null
  signature?: string
  personality?: string
  background?: string
  appearance?: string
  system_prompt?: string
}

export type MoncoreSessionMap = {
  id: MoncoreID
  source: string
  external_session_id: string
  user?: MoncoreID
  assistant?: MoncoreID | null
  character?: MoncoreID | null
  title: string
  session_payload?: MoncoreJsonObject | null
  status: string
  last_message_at?: string | null
  created_at: string
  updated_at: string
}

export type MoncoreMessageMap = {
  id: MoncoreID
  session_map: MoncoreID
  external_message_id: string
  external_parent_message_id?: string
  kind: string
  message_payload?: MoncoreJsonObject | null
  moncore_message_uuid?: string | null
  moncore_step_uuid?: string | null
  tool_call_id?: string
  sync_status: string
  created_at: string
  updated_at: string
}

export type MoncoreCreateSessionInput = {
  source?: string
  external_session_id: string
  assistant?: MoncoreID | null
  character?: MoncoreID | null
  title?: string
  session_payload?: MoncoreJsonObject | null
  status?: string
  last_message_at?: string | null
}

export type MoncoreUpdateSessionInput = {
  title?: string
  session_payload?: MoncoreJsonObject | null
  status?: string
  last_message_at?: string | null
}

export type MoncoreCreateMessageInput = {
  external_message_id: string
  external_parent_message_id?: string
  kind: string
  message_payload?: MoncoreJsonObject | null
  moncore_message_uuid?: string | null
  moncore_step_uuid?: string | null
  tool_call_id?: string
  sync_status?: string
}

export type MoncoreUpdateMessageInput = {
  message_payload?: MoncoreJsonObject | null
  external_parent_message_id?: string
  sync_status?: string
  tool_call_id?: string
}

export type MoncoreLoginInput = {
  baseUrl: string
  username: string
  password: string
}

export type MoncoreLoginResponse = {
  message: string
  user: MoncoreUser
  token: string
  expires_at?: string
  expires_in?: number
  opencode_settings?: MoncoreOpencodeSettings
}

export type MoncoreStoredAuth = {
  baseUrl: string
  token: string
  username: string
  userID?: MoncoreID
  role?: string
  expiresAt?: string
  expiresIn?: number
  loggedInAt: string
  opencodeSettings?: MoncoreOpencodeSettings
}

export type MoncoreAuthStatus = {
  authenticated: boolean
  tokenPresent: boolean
  baseUrl?: string
  username?: string
  userID?: MoncoreID
  role?: string
  expiresAt?: string
}

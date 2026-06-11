export interface AuthUser {
  id: number
  username: string
  display_name?: string | null
  avatar_url?: string | null
  ws_session_id?: string | null
  is_staff: boolean
  is_superuser: boolean
  date_joined?: string
  last_login?: string | null
}

export interface LoginResponse {
  message: string
  user: AuthUser
  token: string
  expires_at: string
  expires_in: number
}

export interface VerifyTokenResponse {
  valid: boolean
  user: AuthUser
  token_info?: {
    valid: boolean
    user: string
    created_at: string
    expires_at: string
    remaining_hours: number
  }
}

export interface CoreCharacterVisualAction {
  action_key: string
  action_label?: string
  enabled?: boolean
}

export interface CoreCharacter {
  id: number
  name: string
  description?: string | null
  avatar_url?: string | null
  default_standing_image_url?: string | null
  visual_actions?: CoreCharacterVisualAction[]
  signature?: string | null
}

export interface CoreAssistant {
  id: number
  name: string
  character_id?: number | null
  character?: CoreCharacter | null
  is_default: boolean
  is_assistant_mode: boolean
  devices?: unknown[]
  created_at?: string
  updated_at?: string
}

declare const __MON_AUTH_MODE__: string | undefined

const browserCoreBaseUrl = (import.meta as unknown as { env?: { DEV?: boolean; VITE_CORE_BASE_URL?: string } }).env?.DEV
  ? "/core-api"
  : ((import.meta as unknown as { env?: { VITE_CORE_BASE_URL?: string } }).env?.VITE_CORE_BASE_URL ??
    "http://127.0.0.1:40011")

const TOKEN_KEY = "agent.auth_token"
const USER_KEY = "agent.auth_user"
const EXPIRES_KEY = "agent.auth_expires_at"
const CLIENT_ID_KEY = "agent.client_id"

function randomClientSuffix() {
  const webCrypto = globalThis.crypto

  if (webCrypto?.randomUUID) {
    return webCrypto.randomUUID()
  }

  if (webCrypto?.getRandomValues) {
    const bytes = new Uint8Array(16)
    webCrypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function getClientMetadata() {
  const clientType = isDesktopRuntime() ? "agent_desktop" : "agent_web"
  let clientId = window.localStorage.getItem(CLIENT_ID_KEY)
  if (!clientId) {
    clientId = `mon-${clientType}:${randomClientSuffix()}`
    window.localStorage.setItem(CLIENT_ID_KEY, clientId)
  }

  return {
    client_id: clientId,
    client_type: clientType,
    clientId,
    clientType,
  }
}

function parseExpiresAt(value: string | null) {
  if (!value) return undefined
  const normalized = value
    .trim()
    .replace(" ", "T")
    .replace(/\.(\d{3})\d+(?=Z|[+-]\d{2}:?\d{2}|$)/, ".$1")
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function parseJsonSafely<T>(text: string) {
  if (!text) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

export function getErrorMessage(error: unknown, fallback = "请求失败") {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === "string" && error.trim()) {
    return error
  }

  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; error?: unknown; cause?: unknown }
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate.message
    }
    if (typeof candidate.error === "string" && candidate.error.trim()) {
      return candidate.error
    }
    if (typeof candidate.cause === "string" && candidate.cause.trim()) {
      return candidate.cause
    }
  }

  return fallback
}

export function isAuthExpiredError(error: unknown) {
  const message = getErrorMessage(error, "")
  return /authentication_expired|core_authentication_expired|not_authenticated|token无效|登录已失效/i.test(message)
}

function isDesktopRuntime() {
  return Boolean(window.monAgentDesktop)
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>) {
  const bridge = window.monAgentDesktop
  if (!bridge) {
    throw new Error("MonAgent 桌面桥接不可用")
  }
  return bridge.invoke<T>(command, args)
}

function mergeUserProfile(user: AuthUser, profile?: Partial<AuthUser> | null): AuthUser {
  if (!profile) return user
  return {
    ...user,
    display_name: profile.display_name ?? user.display_name,
    avatar_url: profile.avatar_url ?? user.avatar_url,
  }
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await fetch(`${browserCoreBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(token ? { Authorization: `Token ${token}` } : {}),
      ...init?.headers,
    },
  })

  const text = await response.text().catch(() => "")
  const data = parseJsonSafely<T & { error?: string; message?: string }>(text)

  if (!response.ok) {
    const errorMessage =
      (data && typeof data === "object" && "error" in data && data.error) ||
      (data && typeof data === "object" && "message" in data && data.message) ||
      `${response.status} ${response.statusText}`
    throw new Error(String(errorMessage))
  }

  return data as T
}

export function getStoredToken() {
  return window.localStorage.getItem(TOKEN_KEY)
}

export function getStoredTokenExpiresAt() {
  return parseExpiresAt(window.localStorage.getItem(EXPIRES_KEY))
}

export function isStoredTokenExpired(skewMs = 15_000) {
  const expiresAt = getStoredTokenExpiresAt()
  return typeof expiresAt === "number" && expiresAt <= Date.now() + skewMs
}

export function getAuthMode(): "development" | "production" {
  if (typeof __MON_AUTH_MODE__ !== "undefined" && __MON_AUTH_MODE__ === "development") {
    return "development"
  }
  return "production"
}

export function getStoredUser() {
  const raw = window.localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export function clearAuth() {
  window.localStorage.removeItem(TOKEN_KEY)
  window.localStorage.removeItem(USER_KEY)
  window.localStorage.removeItem(EXPIRES_KEY)
}

export function saveAuth(payload: { token: string; user: AuthUser; expiresAt?: string }) {
  window.localStorage.setItem(TOKEN_KEY, payload.token)
  window.localStorage.setItem(USER_KEY, JSON.stringify(payload.user))
  if (payload.expiresAt) {
    window.localStorage.setItem(EXPIRES_KEY, payload.expiresAt)
  }
}

export async function loginWithCore(username: string, password: string) {
  const client = getClientMetadata()

  if (isDesktopRuntime()) {
    const response = await invokeDesktop<LoginResponse>("core_login", {
      request: {
        username,
        password,
        clientId: client.clientId,
        clientType: client.clientType,
      },
    })
    const profile = await fetchUserProfile(response.token).catch(() => null)
    const user = mergeUserProfile(response.user, profile)
    saveAuth({
      token: response.token,
      user,
      expiresAt: response.expires_at,
    })
    return { ...response, user }
  }

  const response = await request<LoginResponse>("/api/users/login/", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
      client_id: client.client_id,
      client_type: client.client_type,
    }),
    headers: {
      "X-MON-CLIENT-ID": client.client_id,
      "X-MON-CLIENT-TYPE": client.client_type,
    },
  })

  const profile = await fetchUserProfile(response.token).catch(() => null)
  const user = mergeUserProfile(response.user, profile)

  saveAuth({
    token: response.token,
    user,
    expiresAt: response.expires_at,
  })

  return { ...response, user }
}

export async function verifyTokenWithCore(token: string) {
  if (isDesktopRuntime()) {
    const response = await invokeDesktop<VerifyTokenResponse>("core_verify_token", { token })
    if (!response.valid) {
      throw new Error("Token无效")
    }
    const profile = await fetchUserProfile(token).catch(() => null)
    const user = mergeUserProfile(response.user, profile)
    saveAuth({
      token,
      user,
      expiresAt: response.token_info?.expires_at,
    })
    return { ...response, user }
  }

  const response = await request<VerifyTokenResponse>("/api/users/verify-token/", { method: "GET" }, token)
  if (!response.valid) {
    throw new Error("Token无效")
  }
  const profile = await fetchUserProfile(token).catch(() => null)
  const user = mergeUserProfile(response.user, profile)
  saveAuth({
    token,
    user,
    expiresAt: response.token_info?.expires_at,
  })
  return { ...response, user }
}

export async function fetchUserProfile(token: string) {
  if (isDesktopRuntime()) {
    return invokeDesktop<AuthUser>("core_user_profile", { token })
  }

  return request<AuthUser>("/api/users/me/profile/", { method: "GET" }, token)
}

export async function fetchDefaultAssistant(token: string) {
  if (isDesktopRuntime()) {
    return invokeDesktop<CoreAssistant>("core_default_assistant", { token })
  }

  return request<CoreAssistant>("/api/assistants/default/", { method: "GET" }, token)
}

export function resolveCoreAssetUrl(url?: string | null) {
  if (!url) return undefined
  if (/^(data:|blob:|https?:\/\/)/i.test(url)) return url
  if (url.startsWith("/")) return `${browserCoreBaseUrl}${url}`
  return url
}

export async function logoutWithCore(token: string | null) {
  if (!token) {
    clearAuth()
    return
  }

  try {
    if (isDesktopRuntime()) {
      await invokeDesktop<{ message: string }>("core_logout", { token })
      return
    }
    await request<{ message: string }>("/api/users/logout/", { method: "POST" }, token)
  } finally {
    clearAuth()
  }
}

export interface DevAccount {
  username: string
  password: string
}

export async function getDevAccount(): Promise<DevAccount | null> {
  if (!isDesktopRuntime()) return null
  return invokeDesktop<DevAccount | null>("get_dev_account")
}

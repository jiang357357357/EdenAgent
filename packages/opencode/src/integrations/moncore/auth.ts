import { Global } from "@opencode-ai/core/global"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { unlink } from "fs/promises"
import { writeJson } from "@/util/filesystem"
import type { MoncoreAuthStatus, MoncoreID, MoncoreLoginInput, MoncoreLoginResponse, MoncoreStoredAuth } from "./types"

const authFile = path.join(Global.Path.data, "moncore-auth.json")

function isMoncoreID(value: unknown): value is MoncoreID {
  return typeof value === "number" || typeof value === "string"
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "")
}

function asObject(value: unknown) {
  return typeof value === "object" && value !== null ? value : undefined
}

function decodeStoredAuth(value: unknown): MoncoreStoredAuth | undefined {
  const data = asObject(value)
  if (!data) return
  if (typeof data.baseUrl !== "string" || typeof data.token !== "string" || typeof data.username !== "string") return

  const userID = isMoncoreID(data.userID) ? data.userID : undefined
  const role = typeof data.role === "string" ? data.role : undefined
  const expiresAt = typeof data.expiresAt === "string" ? data.expiresAt : undefined
  const expiresIn = typeof data.expiresIn === "number" ? data.expiresIn : undefined
  const loggedInAt = typeof data.loggedInAt === "string" ? data.loggedInAt : new Date().toISOString()

  return {
    baseUrl: normalizeBaseUrl(data.baseUrl),
    token: data.token,
    username: data.username,
    userID,
    role,
    expiresAt,
    expiresIn,
    loggedInAt,
    opencodeSettings: asObject(data.opencodeSettings) as MoncoreStoredAuth["opencodeSettings"],
  }
}

export function readStoredMoncoreAuthSync() {
  if (!existsSync(authFile)) return undefined
  try {
    return decodeStoredAuth(JSON.parse(readFileSync(authFile, "utf-8")))
  } catch {
    return undefined
  }
}

function toStatus(auth?: MoncoreStoredAuth): MoncoreAuthStatus {
  if (!auth) return { authenticated: false, tokenPresent: false }
  return {
    authenticated: true,
    tokenPresent: auth.token.length > 0,
    baseUrl: auth.baseUrl,
    username: auth.username,
    userID: auth.userID,
    role: auth.role,
    expiresAt: auth.expiresAt,
  }
}

function decodeLoginResponse(value: unknown): MoncoreLoginResponse {
  const data = asObject(value)
  if (!data) throw new Error("MonCore login returned an invalid response")
  const user = asObject(data.user)
  if (!user || !isMoncoreID(user.id) || typeof user.username !== "string") {
    throw new Error("MonCore login did not return a valid user")
  }
  if (typeof data.token !== "string" || data.token.length === 0) {
    throw new Error("MonCore login did not return a token")
  }
  return {
    message: typeof data.message === "string" ? data.message : "登录成功",
    token: data.token,
    user: {
      id: user.id,
      username: user.username,
      role: typeof user.role === "string" ? user.role : undefined,
    },
    expires_at: typeof data.expires_at === "string" ? data.expires_at : undefined,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
    opencode_settings: asObject(data.opencode_settings) as MoncoreLoginResponse["opencode_settings"],
  }
}

async function parseError(response: Response) {
  const text = await response.text()
  try {
    const json = JSON.parse(text) as Record<string, unknown>
    if (typeof json.error === "string") return json.error
    if (typeof json.detail === "string") return json.detail
  } catch {}
  return text || `HTTP ${response.status}`
}

export async function getMoncoreAuthStatus() {
  return toStatus(readStoredMoncoreAuthSync())
}

export async function loginMoncore(input: MoncoreLoginInput) {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const response = await fetch(new URL("api/users/login/", `${baseUrl}/`).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      username: input.username,
      password: input.password,
    }),
  })

  if (!response.ok) {
    throw new Error(await parseError(response))
  }

  const payload = decodeLoginResponse(await response.json())
  const auth: MoncoreStoredAuth = {
    baseUrl,
    token: payload.token,
    username: payload.user.username,
    userID: payload.user.id,
    role: payload.user.role,
    expiresAt: payload.expires_at,
    expiresIn: payload.expires_in,
    loggedInAt: new Date().toISOString(),
    opencodeSettings: payload.opencode_settings,
  }
  await writeJson(authFile, auth, 0o600)
  return toStatus(auth)
}

export async function logoutMoncore() {
  await unlink(authFile).catch(() => undefined)
}

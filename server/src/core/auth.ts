import { CoreAuthenticationExpiredError } from "./client"

export function readAuthToken(request: Request) {
  const value = request.headers.get("authorization")?.trim()
  if (!value) return undefined

  const matched = value.match(/^(?:Token|Bearer)\s+(.+)$/i)
  return (matched?.[1] ?? value).trim() || undefined
}

export function requireCoreToken(request: Request) {
  const token = readAuthToken(request)
  if (!token) {
    throw new CoreAuthenticationExpiredError("/api/agent/sessions/", 401, "not_authenticated")
  }
  return token
}

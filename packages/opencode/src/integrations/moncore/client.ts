import { getMoncoreConfig } from "./config"

export class MoncoreClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message)
    this.name = "MoncoreClientError"
  }
}

function buildHeaders(init?: HeadersInit): HeadersInit {
  const config = getMoncoreConfig()
  const headers = new Headers(init)
  headers.set("Content-Type", "application/json")
  if (config.token) headers.set("Authorization", `Token ${config.token}`)
  return headers
}

function buildUrl(path: string): string {
  const config = getMoncoreConfig()
  if (!config.baseUrl) throw new MoncoreClientError("MONCORE_BASE_URL is not configured")
  return new URL(path.replace(/^\//, ""), `${config.baseUrl.replace(/\/+$/, "")}/`).toString()
}

export async function moncoreRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildUrl(path), {
    ...init,
    headers: buildHeaders(init?.headers),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new MoncoreClientError(`MonCore request failed: ${response.status}`, response.status, body)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

